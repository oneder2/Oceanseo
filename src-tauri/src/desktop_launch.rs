//! Ignore AppImage metadata inherited from a different desktop launcher.
use std::path::Path;

fn belongs_to_current_image(exe: &Path, appdir: Option<&Path>, appimage: Option<&Path>) -> bool {
    let Some((directory, image)) = appdir.zip(appimage) else {
        return false;
    };
    if !directory.is_absolute() || !image.is_absolute() {
        return false;
    }
    let Ok(directory) = directory.canonicalize() else {
        return false;
    };
    let Ok(exe) = exe.canonicalize() else {
        return false;
    };
    directory.parent().is_some()
        && directory.is_dir()
        && exe != directory
        && exe.starts_with(directory)
        && image.is_file()
}

/// Must run before the Tauri builder creates threads and captures its Env.
pub fn sanitize_inherited_appimage() {
    let directory = std::env::var_os("APPDIR");
    let image = std::env::var_os("APPIMAGE");
    if directory.is_none() && image.is_none() {
        return;
    }
    let valid = std::env::current_exe()
        .map(|exe| {
            belongs_to_current_image(
                &exe,
                directory.as_deref().map(Path::new),
                image.as_deref().map(Path::new),
            )
        })
        .unwrap_or(false);
    if !valid {
        std::env::remove_var("APPDIR");
        std::env::remove_var("APPIMAGE");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn unrelated_launcher_is_not_a_restart_target() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("launcher");
        fs::create_dir(&directory).unwrap();
        let image = root.path().join("launcher.AppImage");
        let exe = root.path().join("oceanseo");
        fs::write(&image, []).unwrap();
        fs::write(&exe, []).unwrap();
        assert!(!belongs_to_current_image(
            &exe,
            Some(&directory),
            Some(&image)
        ));
    }

    #[test]
    fn own_appimage_is_preserved_but_missing_metadata_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("mount/usr/bin");
        fs::create_dir_all(&directory).unwrap();
        let image = root.path().join("Oceanseo.AppImage");
        let exe = directory.join("oceanseo");
        fs::write(&image, []).unwrap();
        fs::write(&exe, []).unwrap();
        let mount = root.path().join("mount");
        assert!(belongs_to_current_image(&exe, Some(&mount), Some(&image)));
        assert!(!belongs_to_current_image(&exe, None, Some(&image)));
        assert!(!belongs_to_current_image(&exe, Some(&mount), None));
        fs::remove_file(&image).unwrap();
        assert!(!belongs_to_current_image(&exe, Some(&mount), Some(&image)));
    }

    #[test]
    fn broad_or_similarly_prefixed_paths_are_not_appimage_mounts() {
        let root = tempfile::tempdir().unwrap();
        let mount = root.path().join("mount");
        let other = root.path().join("mount-other");
        fs::create_dir(&mount).unwrap();
        fs::create_dir(&other).unwrap();
        let exe = other.join("oceanseo");
        let image = root.path().join("Oceanseo.AppImage");
        fs::write(&exe, []).unwrap();
        fs::write(&image, []).unwrap();
        assert!(!belongs_to_current_image(&exe, Some(&mount), Some(&image)));
        assert!(!belongs_to_current_image(
            &exe,
            Some(Path::new("/")),
            Some(&image)
        ));
    }

    #[test]
    fn symlink_outside_mount_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let mount = root.path().join("mount");
        fs::create_dir(&mount).unwrap();
        let image = root.path().join("Oceanseo.AppImage");
        let exe = root.path().join("oceanseo");
        fs::write(&image, []).unwrap();
        fs::write(&exe, []).unwrap();
        let link = mount.join("oceanseo");
        std::os::unix::fs::symlink(&exe, &link).unwrap();
        assert!(!belongs_to_current_image(&link, Some(&mount), Some(&image)));
    }
}
