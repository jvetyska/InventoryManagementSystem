CREATE TABLE `location_department` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `LocationID` varchar(13) NOT NULL,
  `DepartmentID` varchar(3) NOT NULL,
  `ClassName` varchar(45) DEFAULT NULL,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`),
  KEY `Location_Department` (`LocationID`,`DepartmentID`),
  CONSTRAINT `fk_locationId` FOREIGN KEY (`LocationID`) REFERENCES `location` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
