CREATE TABLE `customer` (
  `Email` varchar(50) NOT NULL,
  `FirstName` varchar(50) DEFAULT NULL,
  `LastName` varchar(50) DEFAULT NULL,
  `StreetAddress` varchar(50) DEFAULT NULL,
  `City` varchar(50) DEFAULT NULL,
  `State` varchar(50) DEFAULT NULL,
  `ZipCode` varchar(50) NOT NULL,
  `PhoneNumber` varchar(45) DEFAULT NULL,
  `Referer` varchar(100) DEFAULT NULL,
  `SignupDate` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `Newsletter` tinyint NOT NULL DEFAULT '1',
  `DateUpdated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
