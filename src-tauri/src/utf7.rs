//! Modified UTF-7 mailbox-name encoding (RFC 3501 §5.1.3). IMAP transmits
//! non-ASCII mailbox names in this encoding; the app works in UTF-8 and
//! converts at the protocol boundary (encode on the way to the server,
//! decode on names coming back from LIST).

use base64::alphabet::Alphabet;
use base64::engine::general_purpose::NO_PAD;
use base64::engine::{Engine, GeneralPurpose};

// Base64 with ',' in place of '/' (per RFC 3501), unpadded.
fn engine() -> GeneralPurpose {
    let alphabet = Alphabet::new(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,",
    )
    .expect("static alphabet is valid");
    GeneralPurpose::new(&alphabet, NO_PAD)
}

fn flush_run(out: &mut String, run: &mut Vec<u8>) {
    if !run.is_empty() {
        out.push('&');
        out.push_str(&engine().encode(&run));
        out.push('-');
        run.clear();
    }
}

pub fn encode(name: &str) -> String {
    let mut out = String::new();
    let mut run: Vec<u8> = Vec::new(); // pending UTF-16BE bytes
    for ch in name.chars() {
        if (' '..='~').contains(&ch) {
            flush_run(&mut out, &mut run);
            if ch == '&' {
                out.push_str("&-");
            } else {
                out.push(ch);
            }
        } else {
            let mut buf = [0u16; 2];
            for unit in ch.encode_utf16(&mut buf) {
                run.extend_from_slice(&unit.to_be_bytes());
            }
        }
    }
    flush_run(&mut out, &mut run);
    out
}

pub fn decode(name: &str) -> String {
    let mut out = String::new();
    let mut chars = name.chars();
    while let Some(ch) = chars.next() {
        if ch != '&' {
            out.push(ch);
            continue;
        }
        let mut b64 = String::new();
        let mut terminated = false;
        for c in chars.by_ref() {
            if c == '-' {
                terminated = true;
                break;
            }
            b64.push(c);
        }
        if b64.is_empty() {
            // "&-" is a literal ampersand; a trailing lone "&" is malformed —
            // emit it as-is either way.
            out.push('&');
            continue;
        }
        // Malformed sections (no terminator, bad base64, odd UTF-16) pass
        // through literally rather than erroring: a garbled label beats a
        // folder that can't be listed at all.
        let literal = |out: &mut String| {
            out.push('&');
            out.push_str(&b64);
            if terminated {
                out.push('-');
            }
        };
        if !terminated {
            literal(&mut out);
            continue;
        }
        match engine().decode(b64.as_bytes()) {
            Ok(bytes) if bytes.len() % 2 == 0 => {
                let units: Vec<u16> = bytes
                    .chunks(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                match String::from_utf16(&units) {
                    Ok(s) => out.push_str(&s),
                    Err(_) => literal(&mut out),
                }
            }
            _ => literal(&mut out),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_passthrough() {
        assert_eq!(encode("Sent Messages"), "Sent Messages");
        assert_eq!(decode("Sent Messages"), "Sent Messages");
    }

    #[test]
    fn ampersand() {
        assert_eq!(encode("A&B"), "A&-B");
        assert_eq!(decode("A&-B"), "A&B");
    }

    #[test]
    fn non_ascii_roundtrip() {
        for name in ["Kvitton å ä ö", "Résumé", "日本語", "emoji 🙂 too"] {
            assert_eq!(decode(&encode(name)), name);
        }
    }

    #[test]
    fn known_encoding() {
        // RFC 3501's canonical example.
        assert_eq!(encode("~peter/mail/台北/日本語"), "~peter/mail/&U,BTFw-/&ZeVnLIqe-");
        assert_eq!(decode("~peter/mail/&U,BTFw-/&ZeVnLIqe-"), "~peter/mail/台北/日本語");
    }
}
