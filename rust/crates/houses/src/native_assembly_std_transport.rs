//! New assembly routes ONLY. Correctly rounded decimal input is transport,
//! never native provenance, an archive or permission to repair geometry.
//! The historical decoder and serde dependency features are unchanged.
use super::{AssemblePairRequest,NativeAssemblyArchive,RealizeAssemblyRequest};
use serde::de::DeserializeOwned;
use serde_json::{Number,Value};

// A Value intermediate must not erase typed struct duplicate-field errors.
// Serde decodes escaped keys first, so "id" and "i\u0064" collide here too.
struct UniqueValue(Value);
impl<'de> serde::Deserialize<'de> for UniqueValue {
    fn deserialize<D:serde::Deserializer<'de>>(deserializer:D)->Result<Self,D::Error>{
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value=UniqueValue;
            fn expecting(&self,f:&mut std::fmt::Formatter)->std::fmt::Result{f.write_str("JSON with unique object keys")}
            fn visit_bool<E:serde::de::Error>(self,v:bool)->Result<Self::Value,E>{Ok(UniqueValue(Value::Bool(v)))}
            fn visit_i64<E:serde::de::Error>(self,v:i64)->Result<Self::Value,E>{Ok(UniqueValue(Value::Number(v.into())))}
            fn visit_u64<E:serde::de::Error>(self,v:u64)->Result<Self::Value,E>{Ok(UniqueValue(Value::Number(v.into())))}
            fn visit_f64<E:serde::de::Error>(self,v:f64)->Result<Self::Value,E>{
                Ok(UniqueValue(Value::Number(Number::from_f64(v).ok_or_else(||E::custom("nonfinite JSON scalar"))?)))
            }
            fn visit_str<E:serde::de::Error>(self,v:&str)->Result<Self::Value,E>{Ok(UniqueValue(Value::String(v.into())))}
            fn visit_string<E:serde::de::Error>(self,v:String)->Result<Self::Value,E>{Ok(UniqueValue(Value::String(v)))}
            fn visit_unit<E:serde::de::Error>(self)->Result<Self::Value,E>{Ok(UniqueValue(Value::Null))}
            fn visit_seq<A:serde::de::SeqAccess<'de>>(self,mut seq:A)->Result<Self::Value,A::Error>{
                let mut out=Vec::new();while let Some(UniqueValue(v))=seq.next_element()?{out.push(v);}
                Ok(UniqueValue(Value::Array(out)))
            }
            fn visit_map<A:serde::de::MapAccess<'de>>(self,mut map:A)->Result<Self::Value,A::Error>{
                let mut out=serde_json::Map::new();
                while let Some((key,UniqueValue(v)))=map.next_entry::<String,UniqueValue>()?{
                    if out.contains_key(&key){return Err(serde::de::Error::custom("duplicate object key in scoped assembly JSON"));}
                    out.insert(key,v);
                }
                Ok(UniqueValue(Value::Object(out)))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

pub const ASSEMBLY_STD_JSON_CAPABILITY:&str="houses.native-assembly-std-json-v1";
pub const MAX_STD_JSON_BYTES:usize=32*1024*1024;
pub const MAX_STD_REWRITTEN_BYTES:usize=64*1024*1024;
pub const MAX_STD_FLOAT_SLOTS:usize=262144;
const MARKER:&str="_native_assembly_transport_float";

#[derive(Clone,Copy)]
struct Limits{input:usize,rewritten:usize,floats:usize}
const LIMITS:Limits=Limits{input:MAX_STD_JSON_BYTES,rewritten:MAX_STD_REWRITTEN_BYTES,floats:MAX_STD_FLOAT_SLOTS};
fn fail(message:impl std::fmt::Display)->String{format!("[assembly_std_json] {message}")}
fn append(out:&mut Vec<u8>,bytes:&[u8],limit:usize)->Result<(),String>{
    if out.len().checked_add(bytes.len()).is_none_or(|n|n>limit){return Err(fail("rewritten transport budget exceeded; complete input refused"));}
    out.extend_from_slice(bytes);Ok(())
}

// Validate RFC8259 number grammar BEFORE substituting a safe numeric shape.
// This rejects 01,1.,1e+,- and other strings that Std may accept differently.
fn number_grammar(bytes:&[u8])->bool{
    let mut i=0;
    if bytes.get(i)==Some(&b'-'){i+=1;}
    match bytes.get(i){
        Some(b'0')=>i+=1,
        Some(b'1'..=b'9')=>{i+=1;while bytes.get(i).is_some_and(u8::is_ascii_digit){i+=1;}},
        _=>return false,
    }
    if bytes.get(i)==Some(&b'.'){
        i+=1;let start=i;while bytes.get(i).is_some_and(u8::is_ascii_digit){i+=1;}
        if i==start{return false;}
    }
    if bytes.get(i).is_some_and(|b|matches!(b,b'e'|b'E')){
        i+=1;if bytes.get(i).is_some_and(|b|matches!(b,b'+'|b'-')){i+=1;}
        let start=i;while bytes.get(i).is_some_and(u8::is_ascii_digit){i+=1;}
        if i==start{return false;}
    }
    i==bytes.len()
}

fn value_with_limits(bytes:&[u8],limits:Limits)->Result<Value,String>{
    if bytes.len()>limits.input{return Err(fail("input exceeds the transport byte budget"));}
    let mut shape=Vec::with_capacity(bytes.len());
    let mut rewritten=Vec::with_capacity(bytes.len().min(limits.rewritten));
    let mut floats=Vec::new();
    let (mut i,mut quoted,mut escaped)=(0,false,false);
    while i<bytes.len(){
        let byte=bytes[i];
        if quoted{
            if escaped{escaped=false;}else if byte==b'\\'{escaped=true;}else if byte==b'"'{quoted=false;}
            append(&mut shape,&bytes[i..i+1],limits.input)?;
            append(&mut rewritten,&bytes[i..i+1],limits.rewritten)?;i+=1;
        }else if byte==b'"'{
            quoted=true;append(&mut shape,&bytes[i..i+1],limits.input)?;
            append(&mut rewritten,&bytes[i..i+1],limits.rewritten)?;i+=1;
        }else if byte==b'-'||byte.is_ascii_digit(){
            let start=i;
            while i<bytes.len()&&(bytes[i].is_ascii_digit()||b".eE+-".contains(&bytes[i])){i+=1;}
            let token=&bytes[start..i];
            if !number_grammar(token){return Err(fail("invalid JSON number grammar"));}
            let text=std::str::from_utf8(token).map_err(fail)?;
            let integer_fits=if text.starts_with('-'){text.parse::<i64>().is_ok()}else{text.parse::<u64>().is_ok()};
            let needs_std=token.iter().any(|b|b".eE".contains(b))||text=="-0"||!integer_fits;
            if needs_std{
                if floats.len()>=limits.floats{return Err(fail("floating token budget exceeded; no truncation"));}
                let number=text.parse::<f64>().map_err(fail)?;
                if !number.is_finite(){return Err(fail("nonfinite/overflow floating token"));}
                let marker=format!("{{\"{MARKER}\":{}}}",floats.len());
                append(&mut rewritten,marker.as_bytes(),limits.rewritten)?;
                append(&mut shape,b"0",limits.input)?;
                floats.push(number);
            }else{
                append(&mut shape,token,limits.input)?;append(&mut rewritten,token,limits.rewritten)?;
            }
        }else{
            append(&mut shape,&bytes[i..i+1],limits.input)?;
            append(&mut rewritten,&bytes[i..i+1],limits.rewritten)?;i+=1;
        }
    }
    // Parse STRUCTURE and exact i64/u64 only: no original floating token goes
    // through the approximate historical decimal reader. Safe zero shapes
    // also allow finite Std endpoints that its old float parser might reject.
    let UniqueValue(shape)=serde_json::from_slice(&shape).map_err(fail)?;
    let UniqueValue(mut exact)=serde_json::from_slice(&rewritten).map_err(fail)?;
    restore(&shape,&mut exact,&floats)?;
    Ok(exact)
}

fn restore(shape:&Value,exact:&mut Value,floats:&[f64])->Result<(),String>{
    match (shape,exact){
        (Value::Number(_),destination @ Value::Object(_))=>{
            let object=destination.as_object().ok_or_else(||fail("invalid float marker"))?;
            if object.len()!=1{return Err(fail("invalid float marker shape"));}
            let index=object.get(MARKER).and_then(Value::as_u64).and_then(|v|usize::try_from(v).ok())
                .ok_or_else(||fail("invalid float marker index"))?;
            let number=*floats.get(index).ok_or_else(||fail("float marker index outside input"))?;
            *destination=Value::Number(Number::from_f64(number).ok_or_else(||fail("nonfinite restored value"))?);
        },
        (Value::Array(a),Value::Array(b))=>{
            if a.len()!=b.len(){return Err(fail("incoherent numeric array shape"));}
            for (a,b) in a.iter().zip(b){restore(a,b,floats)?;}
        },
        (Value::Object(a),Value::Object(b))=>{
            if a.len()!=b.len(){return Err(fail("incoherent numeric object shape"));}
            for (key,a) in a{restore(a,b.get_mut(key).ok_or_else(||fail("missing original key"))?,floats)?;}
        },
        (a,b) if a==&*b=>{},
        _=>return Err(fail("incoherent original scalar type")),
    }
    Ok(())
}
fn decode<T:DeserializeOwned>(bytes:&[u8])->Result<T,String>{
    serde_json::from_value(value_with_limits(bytes,LIMITS)?).map_err(fail)
}

pub fn parse_pair_request(bytes:&[u8])->Result<AssemblePairRequest,String>{decode(bytes)}


pub fn parse_parent_session_begin(bytes:&[u8])->Result<super::super::parent_session::BeginParentSessionRequest,String>{decode(bytes)}
pub fn parse_parent_session_plan(bytes:&[u8])->Result<super::super::parent_session::PlanParentSessionRequest,String>{decode(bytes)}
pub fn parse_parent_session_ack(bytes:&[u8])->Result<super::super::parent_session::AckParentSessionRequest,String>{decode(bytes)}
pub fn parse_parent_session_close(bytes:&[u8])->Result<super::super::parent_session::CloseParentSessionRequest,String>{decode(bytes)}
pub fn parse_parent_batch_request(bytes:&[u8])->Result<super::super::parent_batch::ParentPlanBatchRequest,String>{decode(bytes)}
pub fn parse_parent_archive(bytes:&[u8])->Result<super::super::parent_batch::NativeParentArchive,String>{decode(bytes)}
pub fn parse_parent_realize_request(bytes:&[u8])->Result<super::super::parent_batch::RealizeParentRequest,String>{decode(bytes)}
pub fn parse_parent_unpack_batch_request(bytes:&[u8])->Result<super::super::parent_batch::UnpackParentBatchRequest,String>{decode(bytes)}

pub fn parse_archive(bytes:&[u8])->Result<NativeAssemblyArchive,String>{decode(bytes)}
pub fn parse_realize_request(bytes:&[u8])->Result<RealizeAssemblyRequest,String>{decode(bytes)}

#[cfg(test)]
#[path = "native_assembly_std_transport_tests.rs"]
mod tests;
