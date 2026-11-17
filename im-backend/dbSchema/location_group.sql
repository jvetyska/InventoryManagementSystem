CREATE TABLE `location_group` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `LocationID` varchar(13) NOT NULL,
  `GroupID` int NOT NULL,
  `Retail_Zone_ID` varchar(6) NOT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
