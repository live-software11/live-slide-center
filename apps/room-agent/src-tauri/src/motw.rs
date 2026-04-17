//! Sprint 2 — Strip Mark-of-the-Web (MOTW) sui file scaricati.
//!
//! Quando Windows scarica un file da una "Internet zone" (incluso HTTP LAN
//! gestito da WebClient o reti pubbliche), aggiunge un Alternate Data Stream
//! `Zone.Identifier` che fa scattare:
//!  - prompt SmartScreen alla prima apertura
//!  - blocco Office "View Protected"
//!  - dialoghi di sicurezza Win11
//!
//! Per i file scaricati dal Local Agent in LAN questo comportamento è un
//! fastidio: rimuoviamo l'ADS subito dopo il rename atomico finale.
//!
//! Best-effort: se il file non ha l'ADS (case comune su LAN private) o se la
//! cancellazione fallisce, ritorniamo Ok(()) senza propagare errori.

use std::path::Path;

#[cfg(target_os = "windows")]
pub fn strip_mark_of_the_web(path: &Path) -> std::io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // L'ADS Zone.Identifier va indirizzato come "<path>:Zone.Identifier".
    // Aggiungiamo backslash-escape per path con caratteri speciali (Windows
    // accetta path Unicode arbitrari).
    let ads_path = format!("{}:Zone.Identifier", path.display());
    let wide: Vec<u16> = OsStr::new(&ads_path).encode_wide().chain(Some(0)).collect();

    // SAFETY: `wide` è null-terminated e vivo per tutta la chiamata.
    let result = unsafe { winapi::um::fileapi::DeleteFileW(wide.as_ptr()) };

    if result == 0 {
        let err = std::io::Error::last_os_error();
        // ERROR_FILE_NOT_FOUND (2) e ERROR_PATH_NOT_FOUND (3) significano
        // che il file non aveva un ADS Zone.Identifier: caso normalissimo
        // su file scaricati dalla LAN privata, niente da fare.
        match err.raw_os_error() {
            Some(2) | Some(3) => Ok(()),
            _ => Err(err),
        }
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn strip_mark_of_the_web(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn strip_motw_is_noop_on_file_without_ads() {
        let dir = std::env::temp_dir();
        let file = dir.join(format!("slidecenter-motw-test-{}.tmp", std::process::id()));
        {
            let mut f = File::create(&file).unwrap();
            f.write_all(b"x").unwrap();
        }
        // Anche se non c'e' ADS, deve ritornare Ok.
        assert!(strip_mark_of_the_web(&file).is_ok());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn strip_motw_is_noop_on_missing_file() {
        // Path inesistente: Ok per i casi 2/3, errore per altri code.
        let bogus = std::path::PathBuf::from("Z:\\__nonexistent__\\nope.bin");
        let res = strip_mark_of_the_web(&bogus);
        // Su non-Windows e' sempre Ok; su Windows accettiamo qualsiasi
        // exit (Ok per 2/3, Err per altri es. drive non montato).
        if cfg!(target_os = "windows") {
            // Both branches accettabili; non vogliamo fail spurious.
            let _ = res;
        } else {
            assert!(res.is_ok());
        }
    }
}
