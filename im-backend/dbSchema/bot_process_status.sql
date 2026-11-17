CREATE TABLE `bot_process_status` (
  `BotProcessHistoryID` int NOT NULL,
  `RowID` bigint NOT NULL AUTO_INCREMENT,
  `Status` varchar(45) NOT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `BatteryPct` tinyint DEFAULT NULL,
  `IsCharging` tinyint DEFAULT NULL,
  `RunQualityPct` float DEFAULT NULL,
  `CompletedWaypoints` int DEFAULT NULL,
  `EPCsCounted` int DEFAULT NULL,
  PRIMARY KEY (`RowID`),
  KEY `BotProcessID_idx` (`BotProcessHistoryID`),
  CONSTRAINT `BotProcessID` FOREIGN KEY (`BotProcessHistoryID`) REFERENCES `bot_process_history` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
