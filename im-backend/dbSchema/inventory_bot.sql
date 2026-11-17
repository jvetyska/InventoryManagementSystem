CREATE TABLE `inventory_bot` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `Status` varchar(45) DEFAULT NULL,
  `ChargingStatus` varchar(45) DEFAULT NULL,
  `IPAddress` varchar(200) DEFAULT NULL,
  `DefaultMap` varchar(45) DEFAULT NULL,
  `MapID` int DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
