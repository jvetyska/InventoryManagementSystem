CREATE TABLE `inventory_case` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Barcode` varchar(13) NOT NULL,
  `ContainerID` varchar(13) NOT NULL,
  `TaskID` bigint DEFAULT NULL,
  `DateCreated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `UserID` int DEFAULT NULL,
  `IsSuspicious` tinyint DEFAULT '0',
  PRIMARY KEY (`ID`),
  KEY `comp_ContainerID` (`ContainerID`,`Barcode`,`TaskID`),
  KEY `comp_TaskID` (`TaskID`,`Barcode`),
  CONSTRAINT `fk_ContainerID` FOREIGN KEY (`ContainerID`) REFERENCES `container` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
