use anyhow::Result;
use tracing::{info, warn};

/// Aggiunge/rimuove il Room Agent dall'autostart di Windows.
/// Usa il registro HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
/// Non richiede privilegi di amministratore (HKCU è scrivibile da utente normale).
#[cfg(target_os = "windows")]
pub fn enable_autostart(exe_path: &str, product_name: &str) -> Result<()> {
    use std::process::Command;
    let key = format!("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let output = Command::new("reg")
        .args([
            "add",
            &key,
            "/v",
            product_name,
            "/t",
            "REG_SZ",
            "/d",
            exe_path,
            "/f",
        ])
        .output()?;
    if output.status.success() {
        info!("Autostart enabled for {}", product_name);
    } else {
        warn!(
            "Autostart reg add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn disable_autostart(product_name: &str) -> Result<()> {
    use std::process::Command;
    let key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    let output = Command::new("reg")
        .args(["delete", key, "/v", product_name, "/f"])
        .output()?;
    if output.status.success() {
        info!("Autostart disabled for {}", product_name);
    }
    Ok(())
}

/// Configura il profilo di rete dell'interfaccia specificata come "Private"
/// per permettere la comunicazione LAN (non bloccata da Windows Firewall default).
/// Richiede PowerShell (disponibile su Win 7+).
#[cfg(target_os = "windows")]
pub fn set_network_private(interface: &str) -> Result<()> {
    use std::process::Command;

    if interface.contains('\'')
        || interface.contains(';')
        || interface.contains('`')
        || interface.contains('$')
        || interface.contains('|')
    {
        anyhow::bail!("Invalid interface name — contains forbidden characters");
    }

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Set-NetConnectionProfile",
            "-InterfaceAlias",
            interface,
            "-NetworkCategory",
            "Private",
        ])
        .output()?;
    if output.status.success() {
        info!(
            "Network profile set to Private for interface '{}'",
            interface
        );
    } else {
        warn!(
            "Set-NetConnectionProfile failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

// Stub per non-Windows
#[cfg(not(target_os = "windows"))]
pub fn enable_autostart(_exe_path: &str, _product_name: &str) -> Result<()> {
    Ok(())
}
#[cfg(not(target_os = "windows"))]
pub fn disable_autostart(_product_name: &str) -> Result<()> {
    Ok(())
}
#[cfg(not(target_os = "windows"))]
pub fn set_network_private(_interface: &str) -> Result<()> {
    Ok(())
}
