CREATE TABLE `note_locations` (
  `NoteID` int NOT NULL,
  `LocationID` varchar(20) NOT NULL,
  PRIMARY KEY (`LocationID`,`NoteID`),
  KEY `ID` (`NoteID`),
  CONSTRAINT `ID` FOREIGN KEY (`NoteID`) REFERENCES `note` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
