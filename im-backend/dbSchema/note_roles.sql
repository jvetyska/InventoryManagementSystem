CREATE TABLE `note_roles` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `NoteID` int NOT NULL,
  `RoleArea` varchar(100) DEFAULT NULL,
  `RoleLevel` varchar(100) DEFAULT NULL,
  `RoleName` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `noteID_idx` (`NoteID`),
  CONSTRAINT `note_roles_NoteID_ID` FOREIGN KEY (`NoteID`) REFERENCES `note` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
