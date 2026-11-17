CREATE TABLE `help_video_users` (
  `VideoID` varchar(25) NOT NULL,
  `UserID` int NOT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_VideoUser` (`VideoID`,`UserID`),
  CONSTRAINT `fk_video_id` FOREIGN KEY (`VideoID`) REFERENCES `help_video` (`VideoID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
