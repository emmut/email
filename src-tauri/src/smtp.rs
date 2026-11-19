use lettre::message::header::{ContentTransferEncoding, ContentType, InReplyTo, References};
use lettre::message::{Mailbox, Mailboxes, MultiPart, SinglePart};
use lettre::Message;

fn parse_recipients(raw: &str, field: &str) -> Result<Mailboxes, String> {
    // Contact autocomplete leaves one trailing comma ready for the next entry.
    // Let lettre parse the list so commas inside quoted names stay intact.
    let raw = raw.trim();
    let raw = raw.strip_suffix(',').unwrap_or(raw).trim_end();
    raw.parse::<Mailboxes>()
        .map_err(|e| format!("invalid {field} recipients: {e}"))
}

// Keep message construction separate from transport so recipient validation and
// the SMTP envelope can be checked without credentials or a network connection.
pub(crate) fn build_message(
    from_email: &str,
    to: &str,
    cc: Option<&str>,
    bcc: Option<&str>,
    subject: &str,
    body_text: &str,
    body_html: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
) -> Result<Message, String> {
    let from_addr: Mailbox = from_email
        .parse::<Mailbox>()
        .map_err(|e| format!("invalid from address: {e}"))?;

    let to = parse_recipients(to, "To")?;
    if to.iter().next().is_none() {
        return Err("To requires at least one recipient".to_string());
    }
    let mut builder = Message::builder().from(from_addr).subject(subject);
    for mailbox in to {
        builder = builder.to(mailbox);
    }
    for mailbox in parse_recipients(cc.unwrap_or_default(), "Cc")? {
        builder = builder.cc(mailbox);
    }
    for mailbox in parse_recipients(bcc.unwrap_or_default(), "Bcc")? {
        builder = builder.bcc(mailbox);
    }
    if let Some(irt) = in_reply_to {
        builder = builder.header(InReplyTo::from(irt.to_string()));
    }
    if let Some(refs) = references {
        builder = builder.header(References::from(refs.to_string()));
    }

    let email = if let Some(html) = body_html {
        builder.multipart(
            MultiPart::alternative()
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_PLAIN)
                        .header(ContentTransferEncoding::QuotedPrintable)
                        .body(body_text.to_string()),
                )
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_HTML)
                        .header(ContentTransferEncoding::QuotedPrintable)
                        .body(html.to_string()),
                ),
        )
    } else {
        builder.singlepart(
            SinglePart::builder()
                .header(ContentType::TEXT_PLAIN)
                .header(ContentTransferEncoding::QuotedPrintable)
                .body(body_text.to_string()),
        )
    };
    email.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::build_message;
    use lettre::message::{header, Mailboxes};
    use lettre::Message;

    fn message(to: &str, cc: Option<&str>, bcc: Option<&str>) -> Result<Message, String> {
        build_message(
            "sender@icloud.com",
            to,
            cc,
            bcc,
            "Hello",
            "Plain body",
            None,
            None,
            None,
        )
    }

    fn recipients(message: &Message) -> Vec<String> {
        message
            .envelope()
            .to()
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    #[test]
    fn includes_every_to_cc_and_bcc_in_the_envelope() {
        let email = message(
            "ann@example.com, bob@example.com",
            Some("cat@example.com, dan@example.com"),
            Some("eve@example.com, fox@example.com"),
        )
        .unwrap();
        assert_eq!(
            recipients(&email),
            [
                "ann@example.com", "bob@example.com", "cat@example.com",
                "dan@example.com", "eve@example.com", "fox@example.com",
            ]
        );
        let headers = email.headers();
        assert_eq!(
            headers.get_raw("To").unwrap(),
            "ann@example.com, bob@example.com"
        );
        assert_eq!(
            headers.get_raw("Cc").unwrap(),
            "cat@example.com, dan@example.com"
        );
        let raw = String::from_utf8(email.formatted()).unwrap();
        assert!(!raw.contains("Bcc:"));
        assert!(!raw.contains("eve@example.com"));
        assert!(!raw.contains("fox@example.com"));
    }

    #[test]
    fn accepts_autocomplete_trailing_commas_and_whitespace_in_all_fields() {
        let email = message(
            " Ann <ann@example.com>, \t",
            Some(" Bob <bob@example.com>, "),
            Some(" cat@example.com, "),
        )
        .unwrap();
        assert_eq!(
            recipients(&email),
            ["ann@example.com", "bob@example.com", "cat@example.com"]
        );
    }

    #[test]
    fn preserves_quoted_display_names_with_commas_and_escaped_quotes() {
        let email = message(
            r#""Öberg, Ann" <ann@example.com>, "Bob \"B\", Smith" <bob@example.com>"#,
            None,
            None,
        )
        .unwrap();
        let to = Mailboxes::from(email.headers().get::<header::To>().unwrap());
        let names: Vec<_> = to.iter().map(|mailbox| mailbox.name.as_deref()).collect();
        assert_eq!(names, [Some("Öberg, Ann"), Some("Bob \"B\", Smith")]);
        assert_eq!(recipients(&email), ["ann@example.com", "bob@example.com"]);
    }

    #[test]
    fn accepts_a_single_recipient_and_empty_optional_fields() {
        for optional in [None, Some(""), Some(" \t")] {
            let email = message("ann@example.com", optional, optional).unwrap();
            assert_eq!(recipients(&email), ["ann@example.com"]);
            assert!(email.headers().get::<header::Cc>().is_none());
        }
    }

    #[test]
    fn rejects_empty_to_even_when_cc_or_bcc_has_recipients() {
        for to in ["", " \t", ", "] {
            assert!(message(to, Some("bob@example.com"), Some("cat@example.com")).is_err());
        }
    }

    #[test]
    fn rejects_invalid_recipients_without_silently_dropping_them() {
        for invalid in [
            "not-an-email",
            "not-an-email, ann@example.com",
            "ann@example.com, not-an-email, bob@example.com",
            "ann@example.com, not-an-email",
            "ann@example.com,, bob@example.com",
            "ann@example.com,, ",
            "\"Unclosed name <ann@example.com>",
        ] {
            for (field, result) in [
                ("To", message(invalid, None, None)),
                ("Cc", message("ann@example.com", Some(invalid), None)),
                ("Bcc", message("ann@example.com", None, Some(invalid))),
            ] {
                let error = result.expect_err(invalid);
                assert!(error.starts_with(&format!("invalid {field} recipients:")));
            }
        }
    }

    #[test]
    fn retains_bodies_and_reply_headers() {
        for html in [None, Some("<p>Rich body</p>")] {
            let email = build_message(
                "sender@icloud.com",
                "ann@example.com",
                None,
                None,
                "Hello",
                "Plain body",
                html,
                Some("<original@example.com>"),
                Some("<parent@example.com> <original@example.com>"),
            )
            .unwrap();
            let raw = String::from_utf8(email.formatted()).unwrap();
            assert!(raw.contains("Subject: Hello\r\n"));
            assert!(raw.contains("In-Reply-To: <original@example.com>\r\n"));
            assert!(raw.contains("References: <parent@example.com> <original@example.com>\r\n"));
            assert!(raw.contains("Plain body"));
            if html.is_some() {
                assert!(raw.contains("multipart/alternative"));
                assert!(raw.contains("<p>Rich body</p>"));
            }
        }
    }
}
