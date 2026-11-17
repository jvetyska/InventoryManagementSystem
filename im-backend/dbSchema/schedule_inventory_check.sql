CREATE TABLE `schedule_inventory_check` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `ScheduleID` bigint NOT NULL,
  `Type` enum('standard','system') DEFAULT NULL,
  `KeycodesToCheck` int DEFAULT NULL,
  `hoursToComplete` int DEFAULT NULL,
  `isCurrentAdjustmentCancelled` tinyint DEFAULT '0',
  PRIMARY KEY (`ID`),
  KEY `sic_scheduleID_fk_idx` (`ScheduleID`),
  CONSTRAINT `sic_scheduleID_fk` FOREIGN KEY (`ScheduleID`) REFERENCES `schedule` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
