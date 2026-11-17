CREATE TABLE `help_files` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Filename` varchar(100) DEFAULT NULL,
  `Type` enum('document','video') DEFAULT NULL,
  `LocationType` enum('STR','WRH','ALL') DEFAULT NULL,
  `FileType` varchar(45) DEFAULT NULL,
  `Format` varchar(45) DEFAULT NULL,
  `FileURL` varchar(200) DEFAULT NULL,
  `Key` varchar(100) DEFAULT NULL,
  `DisplayOrder` int DEFAULT '1',
  `Description` varchar(1000) DEFAULT NULL,
  `Views` int DEFAULT '0',
  `UUID` binary(16) DEFAULT (uuid_to_bin(uuid())),
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`),
  UNIQUE KEY `UUID_UNIQUE` (`UUID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
