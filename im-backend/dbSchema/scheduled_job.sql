CREATE TABLE `scheduled_job` (
  `LocationID` varchar(13) NOT NULL,
  `LastRunDate` datetime NOT NULL,
  `JobName` varchar(45) NOT NULL,
  PRIMARY KEY (`LocationID`,`JobName`),
  CONSTRAINT `fk_location` FOREIGN KEY (`LocationID`) REFERENCES `location` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
