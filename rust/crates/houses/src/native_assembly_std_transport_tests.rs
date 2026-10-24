use super::*;
use serde::Deserialize;

#[test]
fn native_assembly_std_tokens_round_to_the_declared_ieee_bits(){
    let x:Value=decode(br#"{"a":100.00000000119209,"b":103.92499999850989,"c":100.98100000000001,"d":99.64899999518997,"e":2.8000000000000003,"exponent":1.25e+2,"max":1.7976931348623157e308,"tiny":5e-324,"zero":-0,"underflow":-1e-400}"#).unwrap();
    for (key,bits) in [("a",0x40590000000147ae),("b",0x4059fb333331999a),("c",0x40593ec8b4395811),("d",0x4058e98937469c7c)]{
        assert_eq!(x[key].as_f64().unwrap().to_bits(),bits,"{key}");
    }
    assert_eq!(x["e"].as_f64().unwrap().to_bits(),"2.8000000000000003".parse::<f64>().unwrap().to_bits());
    assert_eq!(x["exponent"].as_f64(),Some(125.));
    assert_eq!(x["max"].as_f64().unwrap().to_bits(),f64::MAX.to_bits());
    assert_eq!(x["tiny"].as_f64().unwrap().to_bits(),1);
    assert_eq!(x["zero"].as_f64().unwrap().to_bits(),(-0.0f64).to_bits());
    assert_eq!(x["underflow"].as_f64().unwrap().to_bits(),(-0.0f64).to_bits());
}

#[test]
fn native_assembly_std_preserves_strings_unicode_and_real_marker_objects(){
    let text=r#"{"unicode":"\u00e9 \ud83c\udfe0","text":"-0 1e300 \\\" 2.8000000000000003","object":{"_native_assembly_transport_float":0},"nested":{"_native_assembly_transport_float":2.8000000000000003},"same":0.2,"payload":{"$f64":"8000000000000000"}}"#;
    let x:Value=decode(text.as_bytes()).unwrap();
    let ordinary:Value=serde_json::from_str(text).unwrap();
    assert_eq!(x["unicode"],ordinary["unicode"]);assert_eq!(x["text"],ordinary["text"]);
    assert_eq!(x["object"],ordinary["object"]);
    assert_eq!(x["payload"],ordinary["payload"]);
    assert_eq!(x["nested"][MARKER].as_f64().unwrap().to_bits(),"2.8000000000000003".parse::<f64>().unwrap().to_bits());
    assert_eq!(x["same"].as_f64().unwrap().to_bits(),0.2f64.to_bits());
}

#[test]
fn native_assembly_std_typed_routes_reject_duplicate_known_and_escaped_keys(){
    for text in [br#"{"site":{"id":"a","id":"b"}}"#.as_slice(),br#"{"site":{"id":"a","i\u0064":"b"}}"#.as_slice()]{
        let error=parse_pair_request(text).err().unwrap();assert!(error.contains("duplicate object key"),"{error}");
    }
    for text in [br#"{"format":"a","format":"b"}"#.as_slice(),br#"{"format":"a","f\u006frmat":"b"}"#.as_slice()]{
        let error=parse_archive(text).err().unwrap();assert!(error.contains("duplicate object key"),"{error}");
    }
    for text in [br#"{"interiors":false,"interiors":true}"#.as_slice(),br#"{"interiors":false,"interi\u006frs":true}"#.as_slice()]{
        let error=parse_realize_request(text).err().unwrap();assert!(error.contains("duplicate object key"),"{error}");
    }
}

#[derive(Deserialize)]
struct Integers{u:u64,i:i64}
#[derive(Deserialize)]
struct FloatField{x:f64}
#[derive(Deserialize)]
struct UnsignedField{x:u64}
#[derive(Deserialize)]
struct SignedField{x:i64}

#[test]
fn native_assembly_std_keeps_integer_limits_and_refuses_integer_schema_overflow(){
    let x:Integers=decode(br#"{"u":18446744073709551615,"i":-9223372036854775808}"#).unwrap();
    assert_eq!(x.u,u64::MAX);assert_eq!(x.i,i64::MIN);
    assert_eq!(decode::<UnsignedField>(br#"{"x":1}"#).unwrap().x,1);
    assert_eq!(decode::<SignedField>(br#"{"x":-1}"#).unwrap().x,-1);
    for token in ["18446744073709551616","18446744073709551617","-9223372036854775809"]{
        let text=format!("{{\"x\":{token}}}");
        let f:FloatField=decode(text.as_bytes()).unwrap();
        assert_eq!(f.x.to_bits(),token.parse::<f64>().unwrap().to_bits());
        assert!(decode::<UnsignedField>(text.as_bytes()).is_err());
        assert!(decode::<SignedField>(text.as_bytes()).is_err());
    }
}

#[test]
fn native_assembly_std_rejects_malformed_overflow_and_resource_excess(){
    for text in ["01","1.","1e+","-","+1","NaN","1e999","[1,]","{\"x\":1} trailing","\"unterminated"]{
        assert!(decode::<Value>(text.as_bytes()).is_err(),"{text}");
    }
    let limits=Limits{input:8,rewritten:128,floats:2};
    assert!(value_with_limits(b"[0,0,0,0]",limits).is_err());
    assert!(value_with_limits(b"0.1",Limits{input:8,rewritten:8,floats:2}).is_err());
    assert!(value_with_limits(b"[0.1,0.2]",Limits{input:32,rewritten:128,floats:1}).is_err());
    assert!(restore(&Value::Number(0.into()),&mut serde_json::json!({"_native_assembly_transport_float":99}),&[]).is_err());
}
