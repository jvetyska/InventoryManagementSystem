CREATE TABLE `location_hierarchy_locations` (
  `ID` int unsigned NOT NULL AUTO_INCREMENT,
  `LocationHierarchyID` int unsigned NOT NULL,
  `LocationID` varchar(13) NOT NULL,
  PRIMARY KEY (`ID`),
  UNIQUE KEY `unique_two_columns` (`LocationHierarchyID`,`LocationID`),
  KEY `fk_test_idx` (`LocationHierarchyID`),
  KEY `fk_test2_idx` (`LocationID`),
  CONSTRAINT `fk_location_hierarchy_id` FOREIGN KEY (`LocationHierarchyID`) REFERENCES `location_hierarchy` (`ID`),
  CONSTRAINT `fk_location_hierarchy_location` FOREIGN KEY (`LocationID`) REFERENCES `location` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
