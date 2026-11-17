CREATE TABLE `report_performance` (
  `Date` date NOT NULL,
  `LocationID` varchar(45) NOT NULL,
  `Task` varchar(45) NOT NULL,
  `UserID` int NOT NULL,
  `Username` varchar(45) DEFAULT NULL,
  `Quantity` int NOT NULL,
  `Minutes` int DEFAULT NULL,
  `Seconds` int DEFAULT NULL,
  `HourlyRate` float NOT NULL,
  `Estimated` tinyint DEFAULT NULL,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`LocationID`,`Date`,`Task`,`UserID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
