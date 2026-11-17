CREATE TABLE `help_video` (
  `VideoID` varchar(25) NOT NULL,
  `Title` varchar(255) NOT NULL,
  `Description` varchar(2000) DEFAULT NULL,
  `Type` varchar(45) DEFAULT NULL,
  `SortID` int DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`VideoID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
