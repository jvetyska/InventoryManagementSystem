CREATE TABLE `device_integration` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `Type` varchar(50) DEFAULT NULL,
  `IPAddress` varchar(45) DEFAULT NULL,
  `isRFID` tinyint DEFAULT '1',
  `PrintServer` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ID`),
  UNIQUE KEY `Name_LocationID_Unique` (`LocationID`,`Name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
