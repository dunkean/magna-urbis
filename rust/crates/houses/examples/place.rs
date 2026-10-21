//! Run a retained external placement batch without the browser.
//! cargo run -p magna-urbis-houses --example place -- input.json
fn main() {
    let result = (|| -> Result<(), String> {
        let path = std::env::args()
            .nth(1)
            .ok_or("Expected placement batch JSON path.")?;
        let input = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let output = if std::env::args().any(|arg| arg == "--enrich") {
            let building = serde_json::from_str(&input).map_err(|e| e.to_string())?;
            serde_json::to_string(&magna_urbis_houses::placement::enrich_placement(building)?)
        } else {
            let request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
            serde_json::to_string(&magna_urbis_houses::placement::place_batch(request)?)
        }
        .map_err(|e| e.to_string())?;
        println!("{}", output);
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
