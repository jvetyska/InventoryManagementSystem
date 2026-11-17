CREATE TABLE `note` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Title` varchar(200) NOT NULL,
  `Description` varchar(2000) DEFAULT NULL,
  `Link` varchar(2000) DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `Type` varchar(25) DEFAULT NULL,
  `Quantity` int NOT NULL,
  `DatePublish` date NOT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP,
  `UserCreated` int NOT NULL,
  `UserUpdated` int DEFAULT NULL,
  `MustRead` tinyint DEFAULT '0',
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
