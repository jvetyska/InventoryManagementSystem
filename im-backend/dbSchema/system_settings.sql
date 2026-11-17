CREATE TABLE `system_settings` (
  `Property` varchar(45) NOT NULL,
  `Category` varchar(45) DEFAULT NULL,
  `Value` varchar(45) DEFAULT NULL,
  `Type` varchar(45) DEFAULT NULL,
  `PreviousValue` varchar(45) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `UserUpdated` int DEFAULT NULL,
  PRIMARY KEY (`Property`),
  KEY `ID_idx` (`UserUpdated`),
  CONSTRAINT `user_fk` FOREIGN KEY (`UserUpdated`) REFERENCES `user` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
