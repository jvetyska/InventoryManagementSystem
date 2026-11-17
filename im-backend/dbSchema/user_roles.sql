CREATE TABLE `user_roles` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `UserID` int NOT NULL,
  `UserRole` varchar(50) NOT NULL,
  `AddedBy` int NOT NULL,
  `AddedOn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`),
  KEY `fk_user_id_idx` (`UserID`),
  KEY `fk_user_role_idx` (`UserRole`),
  CONSTRAINT `fk_user_id` FOREIGN KEY (`UserID`) REFERENCES `user` (`ID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_role` FOREIGN KEY (`UserRole`) REFERENCES `user_role` (`RoleName`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
