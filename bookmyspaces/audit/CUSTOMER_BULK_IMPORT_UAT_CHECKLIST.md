# Customer Bulk Import — UAT Checklist

Tester-friendly conversion of the 34-case Validation Test Plan. For each row: perform the action described, compare the actual result to "Expected Result," and mark Pass or Fail. Use "Comments" to note anything unexpected, even if you still mark it Pass.

Before starting, read the **Known Behaviour (Not Defects)** document — items DH-3, DH-4 and PF/DH cross-chunk cases below are expected to behave a specific, non-obvious way; don't log those as bugs.

## 1. Happy Path

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| HP-1 | Upload a file with 3 rows, every column filled in. | All 3 rows import successfully. Every field you filled in appears correctly on the resulting customer records. | ☐ Pass ☐ Fail | |
| HP-2 | Upload a file with 1 row containing only Name and Phone, everything else blank. | The row imports successfully. Optional fields are simply empty on the record — no errors. | ☐ Pass ☐ Fail | |
| HP-3 | Upload a file with 1 row containing Name, Phone, Email, Source filled in, other optional fields blank. | The row imports; filled fields are correct, blank fields stay blank. | ☐ Pass ☐ Fail | |

## 2. Parser Validation

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| PV-1 | Use alternate column headers (e.g. "Full Name," "Mobile," "Mail," "Org," "Province," "DOB" instead of the standard names). | Data still imports correctly under the standard fields — the alternate headers are recognized. | ☐ Pass ☐ Fail | |
| PV-2 | Upload a row with Name left blank. | Row is rejected with an error mentioning "Name is required." Not imported. | ☐ Pass ☐ Fail | |
| PV-3 | Upload a row with Phone left blank. | Row is rejected with an error mentioning "Phone is required." Not imported. | ☐ Pass ☐ Fail | |
| PV-4 | Include one completely blank row in an otherwise normal file. | The blank row is rejected with an error; the rest of the file still imports normally. | ☐ Pass ☐ Fail | |
| PV-5 | Use headers in unusual capitalization (e.g. "NAME," "eMail," "STATE"). | Headers are still recognized correctly regardless of capitalization. | ☐ Pass ☐ Fail | |
| PV-6 | Add an extra column the system doesn't recognize (e.g. "Referral Code"). | The file still imports normally; the extra column is simply ignored. | ☐ Pass ☐ Fail | |
| PV-7 | Include both a "Channel" column and a "Preferred Channel" column in the same file. | "Channel" fills in Source; "Preferred Channel" fills in Preferred Channel. They don't get mixed up. | ☐ Pass ☐ Fail | |
| PV-8 | Enter an obviously invalid phone number (e.g. "12345"). | Row is rejected with an "Invalid phone" error. Not imported. | ☐ Pass ☐ Fail | |

## 3. Duplicate Handling

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| DH-1 | Upload a file with two rows sharing the same phone number. | Only one of the two is imported; the other is counted as "Skipped." | ☐ Pass ☐ Fail | |
| DH-2 | Upload a row whose phone number already belongs to an existing customer. | The row is skipped, no duplicate is created. | ☐ Pass ☐ Fail | |
| DH-3 *(Known Behaviour — not a bug)* | Upload two rows with different phone numbers but the same email address. | **Both rows import as separate customers.** Email is not checked for duplicates — see Known Behaviour doc. | ☐ Pass ☐ Fail | |
| DH-4 *(Known Behaviour — not a bug)* | Upload a row with an existing customer's phone number but a different name. | The row is skipped. **The existing customer's name is not changed.** Bulk Import never updates existing records — see Known Behaviour doc. | ☐ Pass ☐ Fail | |
| DH-5 *(Known Behaviour — not a bug)* | Upload a large file (150+ rows) where the same phone number appears once near the top and once past row 100. | Only the first occurrence imports; the later one is correctly skipped as a duplicate, even though they're far apart in the file. | ☐ Pass ☐ Fail | |

## 4. Database Validation

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| DB-1 | Within a batch of rows, include one row with an invalid date (e.g. "not-a-date" in Date of Visit). | The entire batch of ~100 rows containing that bad row fails together and is reported as errors — not just the one bad row. This is expected; see User Guide's "Date format" note. | ☐ Pass ☐ Fail | |
| DB-2 | Enter a Source value that isn't one of the recognized options (e.g. "carrier_pigeon"). | The row still imports successfully, but Source is automatically set to "excel_import" instead of your entered value. | ☐ Pass ☐ Fail | |
| DB-3 | Upload a row with Name and Phone only, all other fields blank. | Row imports; all blank optional fields show as empty (not as text like "null" or "N/A"). | ☐ Pass ☐ Fail | |
| DB-4 | After any successful import, check that imported customers are linked to that import batch. | Every customer created by the import can be traced back to that specific upload (via internal batch ID — ask your admin/developer to confirm if you don't have direct visibility into this). | ☐ Pass ☐ Fail | |
| DB-5 *(Technical/admin-only check)* | N/A for typical testers — this verifies a database-level safeguard directly. Skip unless you have database access and are asked to run it. | — | ☐ Pass ☐ Fail ☐ N/A | |

## 5. Authentication

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| AU-1 | Log in normally, then upload a file. | The import works normally for a logged-in user. | ☐ Pass ☐ Fail | |
| AU-2 | Log out (or let your session expire), then attempt to upload a file. | The upload is rejected as "Unauthorized." Nothing is imported. | ☐ Pass ☐ Fail | |
| AU-3 | While logged in, view Import History. | Your past imports are listed. | ☐ Pass ☐ Fail | |
| AU-4 | While logged out, attempt to view Import History (e.g. via direct link). | Access is denied as "Unauthorized." | ☐ Pass ☐ Fail | |

## 6. Audit Logging *(admin/backend verification — coordinate with your admin or developer)*

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| AL-1 | Run one import, then check the audit log. | Exactly one audit entry exists for that import — not one per row. | ☐ Pass ☐ Fail | |
| AL-2 | Check who the audit entry credits as having performed the import. | The audit entry correctly shows your (the uploader's) identity. | ☐ Pass ☐ Fail | |
| AL-3 | Compare the audit entry's counts to the on-screen import summary. | Total rows, imported, skipped, and failed counts in the audit entry match exactly what the import screen showed you. | ☐ Pass ☐ Fail | |
| AL-4 | Check that the audit entry references the correct import batch. | The audit entry's batch reference matches the batch ID shown for that import (e.g. in Import History). | ☐ Pass ☐ Fail | |
| AL-5 | (Admin-simulated scenario) If audit logging itself is disrupted, confirm the import still completes. | The import succeeds normally even if, hypothetically, the audit log couldn't be written — it should never block or fail an import. | ☐ Pass ☐ Fail ☐ N/A | |

## 7. Performance

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| PF-1 | Upload a file with 100 rows. | Completes successfully within a reasonable time (well under 30 seconds). Note the actual time taken. | ☐ Pass ☐ Fail | Time taken: _____ |
| PF-2 | Upload a file with 500 rows. | Completes successfully. Note the actual time taken and compare roughly to the 100-row test (should not be dramatically worse than 5x). | ☐ Pass ☐ Fail | Time taken: _____ |
| PF-3 | Upload a file with 1000 rows. | Completes successfully — but this is the size most likely to be slow or time out. If it fails or times out, that's a real finding to report, not just a test failure. Note the actual time taken. | ☐ Pass ☐ Fail | Time taken: _____ |
| PF-4 *(Known Behaviour — not a bug)* | Upload a file with exactly 101 rows. | All 101 rows are handled correctly with no row dropped or duplicated at the boundary. | ☐ Pass ☐ Fail | |

## 8. Rollback *(admin/backend procedure — coordinate with your admin or developer; requires direct database access)*

| Test ID | Description | Expected Result | Pass/Fail | Comments |
|---|---|---|---|---|
| RB-1 | Run two separate import batches, then count how many customers belong to the first batch only. | The count matches exactly what was imported in that batch — no more, no less. | ☐ Pass ☐ Fail | |
| RB-2 | Remove all customers from the first batch only (via the batch reference). | Only the first batch's customers are removed. The second batch is completely untouched. | ☐ Pass ☐ Fail | |
| RB-3 | Remove customers from the first batch matching an additional condition (e.g. same city). | Only matching customers from that specific batch are removed — nothing from the other batch, nothing that doesn't match the extra condition. | ☐ Pass ☐ Fail | |
| RB-4 | After removing a batch's customers, check the import history for that batch. | The import history record (and its audit log entry) still exists — only the customer records were removed, not the history of the import itself. | ☐ Pass ☐ Fail | |

---

**Sign-off**

Tester name: _______________  Date: _______________

Total cases: 34  Passed: _____  Failed: _____  N/A: _____

Overall UAT result: ☐ Approved for release ☐ Blocked — see comments above
