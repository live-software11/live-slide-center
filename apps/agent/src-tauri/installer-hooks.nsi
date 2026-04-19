; Live SLIDE CENTER — Local Agent
; NSIS installer hooks: bypass permessi Windows 11.
; Eseguiti durante l'installazione (admin) UNA volta sola.
; Il runtime gira poi come utente normale, niente UAC.
;
; Fix Sprint W follow-up (apr 2026): refactor da single-quoted (`'...'`) a
; backtick (`` `...` ``) come delimitatore esterno NSIS. Motivo: NSIS interpreta
; due single-quote consecutive (`''`) dentro stringa single-quoted come
; "chiudi/riapri stringa", spezzando il comando in 3 parametri quando il
; PowerShell interno contiene `''$LOCALAPPDATA\...''`. Backtick è tollerante
; e non collide con PowerShell. Stesso fix gia' applicato in
; `apps/desktop/src-tauri/installer-hooks.nsi`. Inoltre `$_` PowerShell va
; scritto `$$_` per non essere interpretato da NSIS come variable register.

!macro NSIS_HOOK_POSTINSTALL
  ; ── 1) Firewall: apri porta 8080 TCP in ingresso per LAN/Domain ─────────
  ;     Necessario perche' il Local Agent serve i Room Agent sulla LAN.
  ;     Profili: private + domain (mai public per sicurezza).
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent"`
  ExecWait `netsh advfirewall firewall add rule name="Live SLIDE CENTER Agent" dir=in action=allow protocol=TCP localport=8080 program="$INSTDIR\local-agent.exe" profile=private,domain enable=yes`

  ; ── 2) Firewall: apri porta UDP 9999 per discovery broadcast ───────────
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent Discovery"`
  ExecWait `netsh advfirewall firewall add rule name="Live SLIDE CENTER Agent Discovery" dir=in action=allow protocol=UDP localport=9999 program="$INSTDIR\local-agent.exe" profile=private,domain enable=yes`

  ; ── 3) Firewall: apri porta UDP 5353 per mDNS (Bonjour-like) ───────────
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent mDNS"`
  ExecWait `netsh advfirewall firewall add rule name="Live SLIDE CENTER Agent mDNS" dir=in action=allow protocol=UDP localport=5353 program="$INSTDIR\local-agent.exe" profile=private,domain enable=yes`

  ; ── 4) Defender: esclusione cartella cache per evitare scan continuo ───
  ;     Errore tollerato (Defender disabilitato / non disponibile).
  ExecWait `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath '$LOCALAPPDATA\LiveSLIDECENTER' -Force -ErrorAction SilentlyContinue"`

  ; ── 5) Profilo rete: imposta Private per consentire LAN ───────────────
  ;     Errore tollerato se non c'e' una rete attiva.
  ExecWait `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-NetConnectionProfile | Where-Object { $$_.NetworkCategory -eq 'Public' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"`
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; ── 0) Sprint 4: deattivazione licenza per liberare slot hardware ───────
  ;     `local-agent.exe --deactivate` -> chiama POST /license/deactivate su
  ;     Live WORKS APP e cancella license.enc locale. Senza feature `license`
  ;     compilata e' un no-op (early return innocuo). Errore tollerato:
  ;     l'utente puo' essere offline durante l'uninstall.
  ExecWait `"$INSTDIR\local-agent.exe" --deactivate`

  ; Cleanup regole firewall create al primo install
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent"`
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent Discovery"`
  ExecWait `netsh advfirewall firewall delete rule name="Live SLIDE CENTER Agent mDNS"`

  ; Cleanup esclusione Defender
  ExecWait `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath '$LOCALAPPDATA\LiveSLIDECENTER' -Force -ErrorAction SilentlyContinue"`
!macroend
