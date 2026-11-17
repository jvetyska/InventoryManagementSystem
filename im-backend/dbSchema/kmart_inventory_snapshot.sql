CREATE TABLE `kmart_inventory_snapshot` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `LocationID` varchar(13) NOT NULL,
  `Keycode` int NOT NULL,
  `Quantity` int NOT NULL,
  `DateKmartManifest` datetime DEFAULT NULL,
  `BackfillScheduleID` int DEFAULT NULL,
  `SnapshotType` enum('ScheduleStart','ScheduleEnd') DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`),
  KEY `idx_BackfillSchedule` (`BackfillScheduleID`,`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
