CREATE TABLE `device` (
  `ID` int unsigned NOT NULL AUTO_INCREMENT,
  `Token` varchar(64) DEFAULT NULL,
  `CreatedBy` int DEFAULT NULL,
  `IPAddress` varchar(12) DEFAULT NULL,
  `UserAgent` varchar(200) DEFAULT NULL,
  `CreatedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  `ExpirationDate` datetime DEFAULT NULL,
  `LastUsed` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
