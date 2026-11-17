CREATE TABLE `inventory_take_schedule` (
  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `BackfillScheduleID` bigint NOT NULL,
  `Type` enum('InventoryBot','Manual','RealtimeRFID') NOT NULL DEFAULT 'InventoryBot',
  `InventoryBotID` int DEFAULT NULL,
  `InventoryBotArea` varchar(45) DEFAULT NULL,
  `Hour` int NOT NULL,
  `Minute` int NOT NULL,
  `ContainerID` varchar(45) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `MinsToComplete` int DEFAULT '0',
  PRIMARY KEY (`ID`),
  KEY `fk_backfill_Schedule_idx` (`BackfillScheduleID`),
  CONSTRAINT `fk_backfill_Schedule` FOREIGN KEY (`BackfillScheduleID`) REFERENCES `store_backfill_schedule` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
