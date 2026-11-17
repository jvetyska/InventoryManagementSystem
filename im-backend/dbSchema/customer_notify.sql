CREATE TABLE `customer_notify` (
  `Email` varchar(50) NOT NULL,
  `Keycode` int NOT NULL,
  `StyleID` int DEFAULT NULL,
  `Colour` varchar(25) DEFAULT NULL,
  `Referer` varchar(100) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `DateNotified` datetime DEFAULT NULL,
  PRIMARY KEY (`Email`,`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
