# Customer Bulk Import — User Guide

## Supported file formats

- `.xlsx`, `.xls`, `.csv`
- Maximum file size: **5 MB**
- The first sheet of the workbook is read (for `.xlsx`/`.xls`); the first row must be the header row.

## Required columns

| Column | Notes |
|---|---|
| **Name** | Must not be blank. |
| **Phone** | Must not be blank and must be a valid phone number (10+ digits, optional `+` country code). |

If either is missing or invalid, the row is rejected and reported as an error — it is not imported.

## Optional columns

All of the following may be left blank. A blank value is stored as empty (not as the word "blank" or a placeholder):

| Column | Notes |
|---|---|
| Email | Validated for format if provided; not required. |
| Company | Free text. |
| Source | See "Source field rules" below. |
| Notes | Free text. |
| City | Free text. |
| State | Free text. |
| Country | Free text. |
| Address | Free text. |
| Date of Visit | See "Date format" below. |
| Birthday | See "Date format" below. |
| Anniversary | See "Date format" below. |
| Preferred Channel | Free text — not restricted to a fixed list. |

## Header aliases

Column headers are matched case-insensitively and with extra spaces trimmed. Any of the following headers are recognized for the same field:

| Field | Recognized headers |
|---|---|
| Name | Name, Full Name, Contact Name, Client Name |
| Phone | Phone, Mobile, WhatsApp, Contact, Number |
| Email | Email, Email Address, Mail |
| Company | Company, Organization, Org, Business |
| Source | Source, Lead Source, Channel |
| Notes | Notes, Note, Remarks, Comments |
| City | City |
| State | State, Province |
| Country | Country |
| Address | Address, Street Address |
| Date of Visit | Date of Visit, Visit Date, date_of_visit |
| Birthday | Birthday, Date of Birth, DOB |
| Anniversary | Anniversary |
| Preferred Channel | Preferred Channel, preferred_channel |

Any column header not on this list is ignored — it will not cause an error, but its data will not be imported. Note: a header named exactly **"Channel"** is recognized as **Source**, not Preferred Channel — use "Preferred Channel" (two words) for that field.

## Date format

Date of Visit, Birthday, and Anniversary are **not format-checked at upload time**. Use `YYYY-MM-DD` (e.g. `2026-08-15`) for reliability — this matches the downloadable template and is the format the database expects.

**Important:** if a date value in one of these columns is not a valid date, the error will not be caught until the file is saved to the database, and it will cause **every row in that batch of ~100 rows to fail together**, not just the one bad row. If you get an unexpected wave of failures, check whether a date column has a stray or malformed value in that section of your file.

## Source field rules

If provided, Source must be one of the following values to be kept as-is:

`website, whatsapp, instagram, justdial, referral, other, proposal, excel_import, web, whatsapp_website, whatsapp_facebook, whatsapp_instagram, facebook`

Any other value (including blank) is automatically replaced with `excel_import`. This happens silently — the row still imports successfully, just with a different Source value than what was in the file.

## Common validation errors

| Error message | Cause | Fix |
|---|---|---|
| "Name is required" | Name column blank. | Fill in the Name column. |
| "Phone is required" | Phone column blank. | Fill in the Phone column. |
| "Invalid phone: …" | Phone doesn't look like a real number (too short, non-numeric). | Correct the phone number. |
| "Invalid email: …" | Email doesn't match a standard email pattern. | Correct or blank out the email. |
| "Database rejected this row: …" | The row (or another row in its ~100-row batch) violated a database rule — most commonly, a malformed date in Date of Visit/Birthday/Anniversary. | Check date columns for that batch of rows; re-upload the corrected rows. |

Rows that fail validation are listed in the import result and are **not** imported — no partial rows are created.
