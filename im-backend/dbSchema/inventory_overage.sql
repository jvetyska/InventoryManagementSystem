CREATE TABLE `inventory_overage` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `ContainerID` varchar(13) NOT NULL,
  `Keycode` int NOT NULL DEFAULT '0',
  `ProductID` varchar(13) DEFAULT NULL,
  `TaskID` bigint DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `UserID` int DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
