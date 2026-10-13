fn main() {
    println!("cargo:rerun-if-env-changed=OCEANSEO_ANDROID_PRODUCT");
    println!("cargo:rerun-if-env-changed=ORG_GRADLE_PROJECT_oceanseoAndroidProduct");
    println!("cargo:rerun-if-changed=android-products.json");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        let selected =
            std::env::var("OCEANSEO_ANDROID_PRODUCT").unwrap_or_else(|_| "personal".into());
        if let Ok(gradle) = std::env::var("ORG_GRADLE_PROJECT_oceanseoAndroidProduct") {
            assert_eq!(selected, gradle, "Android Gradle/native product mismatch");
        }
        let products: serde_json::Value =
            serde_json::from_str(include_str!("android-products.json"))
                .expect("Invalid Android product manifest");
        assert_eq!(products["version"], 1);
        assert_eq!(products["jniNamespace"], "com.tideplan.mobile");
        assert!(selected == "personal", "Unknown Android product");
        let identifier = products["products"][&selected]["applicationId"]
            .as_str()
            .expect("Missing Android installation ID");
        assert!(
            identifier == "com.tideplan.mobile",
            "Unsupported Android installation ID"
        );
        // Android applicationId and Java/JNI namespace are separate concepts.
        // Keep one common native bridge, bind runtime product to the same
        // checked product manifest that finalizes Gradle's installation ID.
        println!("cargo:rustc-env=OCEANSEO_RUNTIME_IDENTIFIER={identifier}");
    } else {
        assert!(
            std::env::var_os("OCEANSEO_ANDROID_PRODUCT").is_none(),
            "Android product flag cannot enter a desktop build"
        );
    }
    tauri_build::build();
}
