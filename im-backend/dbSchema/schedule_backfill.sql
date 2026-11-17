CREATE TABLE `schedule_backfill` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `ScheduleID` bigint NOT NULL,
  PRIMARY KEY (`ID`),
  KEY `sb_scheduleID_fk_idx` (`ScheduleID`),
  CONSTRAINT `sb_scheduleID_fk` FOREIGN KEY (`ScheduleID`) REFERENCES `schedule` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
