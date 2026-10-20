//! Test fixtures only: preserve their IEEE754 decimal image with Std features.
use serde_json::{Number, Value};

pub(super) fn value(bytes: &[u8]) -> Value {
    let original: Value = serde_json::from_slice(bytes).unwrap();
    let mut rewritten = Vec::with_capacity(bytes.len());
    let mut floats = Vec::new();
    let (mut i, mut quoted, mut escaped) = (0, false, false);
    while i < bytes.len() {
        let byte = bytes[i];
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
            rewritten.push(byte);
            i += 1;
        } else if byte == b'"' {
            quoted = true;
            rewritten.push(byte);
            i += 1;
        } else if byte == b'-' || byte.is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || b".eE+-".contains(&bytes[i])) {
                i += 1;
            }
            let token = std::str::from_utf8(&bytes[start..i]).unwrap();
            if token.contains(['.', 'e', 'E']) || token == "-0" {
                let index = floats.len();
                floats.push(token.parse::<f64>().unwrap());
                rewritten.extend_from_slice(format!("{{\"_fixture_float\":{index}}}").as_bytes());
            } else {
                rewritten.extend_from_slice(&bytes[start..i]);
            }
        } else {
            rewritten.push(byte);
            i += 1;
        }
    }
    let mut exact: Value = serde_json::from_slice(&rewritten).unwrap();
    restore(&original, &mut exact, &floats);
    exact
}

fn restore(original: &Value, exact: &mut Value, floats: &[f64]) {
    match (original, exact) {
        // Pairing against the original type prevents collision with a genuine
        // object/string carrying the same key. Only rewritten number slots qualify.
        (Value::Number(_), destination @ Value::Object(_)) => {
            let index = destination["_fixture_float"].as_u64().unwrap() as usize;
            *destination = Value::Number(Number::from_f64(floats[index]).unwrap());
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                restore(a, b, floats);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (key, a) in a {
                restore(a, b.get_mut(key).unwrap(), floats);
            }
        }
        (a, b) => assert_eq!(a, b),
    }
}

#[test]
fn preserves_integer_unicode_string_escape_negative_zero_and_marker_objects() {
    let text = r#"{"u":18446744073709551615,"i":-9223372036854775808,"f":2.8000000000000003,"z":-0.0,"s":"é🏠 \\\" 2.8","o":{"_fixture_float":0}}"#;
    let exact = value(text.as_bytes());
    assert_eq!(exact["u"].as_u64(), Some(u64::MAX));
    assert_eq!(exact["i"].as_i64(), Some(i64::MIN));
    assert_eq!(
        exact["f"].as_f64().unwrap().to_bits(),
        "2.8000000000000003".parse::<f64>().unwrap().to_bits()
    );
    assert_eq!(exact["z"].as_f64().unwrap().to_bits(), (-0.0f64).to_bits());
    let ordinary: Value = serde_json::from_str(text).unwrap();
    assert_eq!(exact["s"], ordinary["s"]);
    assert_eq!(exact["o"], ordinary["o"]);
}

fn all_bits(value: &Value, path: &str, out: &mut std::collections::BTreeMap<String, String>) {
    match value {
        Value::Number(n) if n.is_f64() => {
            out.insert(
                path.into(),
                format!("{:016x}", n.as_f64().unwrap().to_bits()),
            );
        }
        Value::Array(a) => {
            for (i, v) in a.iter().enumerate() {
                all_bits(v, &format!("{path}/{i}"), out);
            }
        }
        Value::Object(a) => {
            for (key, v) in a {
                all_bits(v, &format!("{path}/{key}"), out);
            }
        }
        _ => {}
    }
}

#[test]
fn every_reduced_fixture_float_matches_the_native_bit_reference() {
    let exact = value(include_bytes!(
        "../../tests/fixtures/legacy27j-reduced-native-unit.json"
    ));
    let expected: std::collections::BTreeMap<String, String> = serde_json::from_slice(
        include_bytes!("../../tests/fixtures/legacy27j-reduced-native-bits.json"),
    )
    .unwrap();
    let mut actual = std::collections::BTreeMap::new();
    all_bits(&exact, "", &mut actual);
    assert_eq!(actual, expected);
}

#[test]
fn every_historical_fixture_float_matches_the_native_bit_reference() {
    let exact = value(include_bytes!(
        "../../../../fixtures/houses/parapet-him2.json"
    ));
    let expected: std::collections::BTreeMap<String, String> = serde_json::from_slice(
        include_bytes!("../../tests/fixtures/parapet-him2-native-bits.json"),
    )
    .unwrap();
    let mut actual = std::collections::BTreeMap::new();
    all_bits(&exact, "", &mut actual);
    assert_eq!(actual, expected);
}

#[test]
fn every_phase_and_original_terminal_float_matches_its_native_bit_reference() {
    for (source, reference) in [
        (
            include_bytes!("../../tests/fixtures/legacy27j-phase-unit.json").as_slice(),
            include_bytes!("../../tests/fixtures/legacy27j-phase-unit-bits.json").as_slice(),
        ),
        (
            include_bytes!("../../tests/fixtures/legacy27j-terminal-original-unit.json").as_slice(),
            include_bytes!("../../tests/fixtures/legacy27j-terminal-original-unit-bits.json")
                .as_slice(),
        ),
    ] {
        let exact = value(source);
        let expected: std::collections::BTreeMap<String, String> =
            serde_json::from_slice(reference).unwrap();
        let mut actual = std::collections::BTreeMap::new();
        all_bits(&exact, "", &mut actual);
        assert_eq!(actual, expected);
    }
}
