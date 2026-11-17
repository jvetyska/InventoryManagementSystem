CREATE TABLE `filtered_epc_tags` (
  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `Barcode` varchar(13) DEFAULT NULL,
  `TagID` varchar(30) DEFAULT NULL,
  `XPosition` float DEFAULT NULL,
  `YPosition` float DEFAULT NULL,
  `ZPosition` float DEFAULT NULL,
  `Certainty` float DEFAULT NULL,
  `MapAreaID` varchar(30) DEFAULT NULL,
  `RunName` varchar(45) DEFAULT NULL,
  `InventoryBotID` int DEFAULT NULL,
  `Reason` varchar(45) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `UserID` int DEFAULT NULL,
  `TaskID` int DEFAULT NULL,
  `ContainerID` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `idx_InventoryBot` (`InventoryBotID`,`RunName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
