CREATE TABLE `inventory_bot_area` (
  `InventoryBotID` int NOT NULL,
  `Area` varchar(45) NOT NULL,
  `ContainerID` varchar(13) DEFAULT NULL,
  `Map` varchar(45) DEFAULT NULL,
  `MapID` int DEFAULT NULL,
  `MaxRunDurationMinutes` int DEFAULT NULL,
  PRIMARY KEY (`InventoryBotID`,`Area`),
  KEY `fk_iba_ContainerID` (`ContainerID`),
  CONSTRAINT `fk_iba_ContainerID` FOREIGN KEY (`ContainerID`) REFERENCES `container` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
