CREATE TABLE `help_watched` (
  `UserID` int NOT NULL,
  `HelpfileID` int NOT NULL,
  `Watched` tinyint DEFAULT '1',
  `DateViewed` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`UserID`,`HelpfileID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
