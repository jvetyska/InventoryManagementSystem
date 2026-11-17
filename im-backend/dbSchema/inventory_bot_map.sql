CREATE TABLE `inventory_bot_map` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `InventoryBotID` int NOT NULL,
  `Type` enum('Location','Run') DEFAULT NULL,
  `MapUrl` varchar(1000) DEFAULT NULL,
  `MapName` varchar(100) DEFAULT NULL,
  `MapHeight` int DEFAULT NULL,
  `MapWidth` int DEFAULT NULL,
  `CellSize` float DEFAULT NULL,
  `OffSetX` int DEFAULT NULL,
  `OffSetY` int DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
