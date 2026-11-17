CREATE TABLE `schedule_stocktake` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `ScheduleID` bigint NOT NULL,
  `Type` enum('InventoryBot','Manual','RealtimeRFID') NOT NULL,
  `InventoryBotID` int DEFAULT NULL,
  `InventoryBotArea` varchar(45) DEFAULT NULL,
  `ContainerID` varchar(13) DEFAULT NULL,
  `MinsToComplete` int DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `ss_scheduleID_fk_idx` (`ScheduleID`),
  CONSTRAINT `ss_scheduleID_fk` FOREIGN KEY (`ScheduleID`) REFERENCES `schedule` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
