CREATE TABLE `product_blacklist_raw` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `LocationID` varchar(25) DEFAULT NULL,
  `DepartmentID` varchar(3) DEFAULT NULL,
  `Class_Name` varchar(55) DEFAULT NULL,
  `Sub_Class_Name` varchar(55) DEFAULT NULL,
  `Keycode` int DEFAULT NULL,
  `Retail_Zone_ID` varchar(6) DEFAULT NULL,
  `Program` varchar(45) DEFAULT NULL,
  `DateStart` date DEFAULT NULL,
  `DateEnd` date DEFAULT NULL,
  `Exception` tinyint DEFAULT '0',
  `Comment` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `Keycode` (`Keycode`),
  KEY `Location_idx` (`LocationID`),
  CONSTRAINT `Location` FOREIGN KEY (`LocationID`) REFERENCES `container` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
