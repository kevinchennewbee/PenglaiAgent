# iMessage native/live evidence

Status: `LIVE_NOT_RUN`

This 0.6.1 source milestone rewrites optional Darwin iMessage private text
from reviewed dsh-im 4.18.0 sources. Tests use a neutral in-memory fixture
database and injected `execFile` / `osascript` seams.

The following were **not** run and must not be marked PASS:

- reading real `~/Library/Messages/chat.db`
- reading Contacts / AddressBook
- launching Messages.app
- real AppleScript automation
- sending a real iMessage
- asking for or granting TCC Full Disk Access or Automation

Fixture proof is not native messaging proof.
