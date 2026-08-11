import os
import stat
import tempfile
import unittest
import unittest.mock
import plugins.plugin_email
from plugins.plugin_email import EmailPlugin

class TestEmailSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the credentials file
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_creds_file = plugins.plugin_email._CREDS_FILE
        # Override the _CREDS_FILE to point to our temp directory path
        self.temp_creds_path = os.path.join(self.test_dir.name, "email_creds.json")
        plugins.plugin_email._CREDS_FILE = self.temp_creds_path
        self.plugin = EmailPlugin()

    def tearDown(self):
        # Restore original _CREDS_FILE path
        plugins.plugin_email._CREDS_FILE = self.original_creds_file
        self.test_dir.cleanup()

    def test_configure_file_permissions(self):
        # Call configure on the plugin
        self.plugin.call(
            "configure",
            email_addr="test@example.com",
            password="super_secure_password_123",
            imap_host="imap.example.com",
            smtp_host="smtp.example.com"
        )

        # Verify the file was created
        self.assertTrue(os.path.exists(self.temp_creds_path))

        # Check file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(self.temp_creds_path)
            permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(permissions, 0o600, f"Expected 0o600 permissions, got {oct(permissions)}")

    @unittest.mock.patch("smtplib.SMTP")
    def test_send_header_injection_sanitization(self, mock_smtp):
        # Configure first so we have credentials
        self.plugin.call(
            "configure",
            email_addr="sender@example.com\r\nBcc: evil-sender@attacker.com",
            password="pass",
            imap_host="imap.example.com",
            smtp_host="smtp.example.com"
        )

        # Set up a mock SMTP instance
        mock_instance = mock_smtp.return_value.__enter__.return_value

        # Call send with malicious subject and recipient
        to_addr = "receiver@example.com\r\nBcc: evil-to@attacker.com"
        subject = "Hello\r\nBcc: evil-subject@attacker.com\r\nX-Injected: true"
        body = "MIME body content"

        self.plugin.call("send", to=to_addr, subject=subject, body=body)

        # Check that send_message was called on mock_instance
        self.assertTrue(mock_instance.send_message.called)
        sent_msg = mock_instance.send_message.call_args[0][0]

        # Verify the headers are sanitized and do not contain CRLF
        self.assertNotIn("\n", sent_msg["From"])
        self.assertNotIn("\r", sent_msg["From"])
        self.assertNotIn("\n", sent_msg["To"])
        self.assertNotIn("\r", sent_msg["To"])
        self.assertNotIn("\n", sent_msg["Subject"])
        self.assertNotIn("\r", sent_msg["Subject"])

        # Verify specific injections are neutralized (spaces replaced CRLF)
        self.assertIn("sender@example.com Bcc: evil-sender@attacker.com", sent_msg["From"])
        self.assertIn("receiver@example.com Bcc: evil-to@attacker.com", sent_msg["To"])
        self.assertIn("Hello Bcc: evil-subject@attacker.com X-Injected: true", sent_msg["Subject"])

if __name__ == "__main__":
    unittest.main()
