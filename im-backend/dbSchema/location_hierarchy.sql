CREATE TABLE `location_hierarchy` (
  `ID` int unsigned NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) NOT NULL,
  `ParentID` int unsigned DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `fk_location_hierarchy_parent_id_idx` (`ParentID`),
  CONSTRAINT `fk_location_hierarchy_parent_id` FOREIGN KEY (`ParentID`) REFERENCES `location_hierarchy` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
