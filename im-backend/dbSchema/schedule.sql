CREATE TABLE `schedule` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `LocationID` varchar(13) NOT NULL,
  `Hour` int NOT NULL,
  `Minute` int NOT NULL,
  `Name` varchar(45) DEFAULT NULL,
  `Sun` tinyint DEFAULT NULL,
  `Mon` tinyint DEFAULT NULL,
  `Tue` tinyint DEFAULT NULL,
  `Wed` tinyint DEFAULT NULL,
  `Thu` tinyint DEFAULT NULL,
  `Fri` tinyint DEFAULT NULL,
  `Sat` tinyint DEFAULT NULL,
  `isEnabled` tinyint DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
