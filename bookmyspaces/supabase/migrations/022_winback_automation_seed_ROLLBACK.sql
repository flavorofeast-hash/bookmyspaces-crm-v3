-- ROLLBACK for 022_winback_automation_seed.sql
-- Removes the system-owned win-back campaign row only (identified by its
-- notes marker) — does not touch any operator-created campaigns, even if
-- they also happen to use the 'dormant' type.

DELETE FROM broadcast_campaigns WHERE notes = 'SYSTEM_WINBACK_AUTOMATION';
