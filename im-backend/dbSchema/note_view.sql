CREATE TABLE `note_view` (
  `NoteID` int NOT NULL,
  `UserID` int NOT NULL,
  `Viewed` tinyint DEFAULT NULL,
  `Read` tinyint DEFAULT NULL,
  PRIMARY KEY (`NoteID`,`UserID`),
  KEY `UserID_idx` (`UserID`),
  CONSTRAINT `NID` FOREIGN KEY (`NoteID`) REFERENCES `note` (`ID`) ON DELETE CASCADE,
  CONSTRAINT `UID` FOREIGN KEY (`UserID`) REFERENCES `user` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
