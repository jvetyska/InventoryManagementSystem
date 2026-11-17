CREATE TABLE `location_env` (
  `LocationID` varchar(13) NOT NULL,
  `isUAT` tinyint(1) NOT NULL DEFAULT '1',
  `isDEV` tinyint(1) NOT NULL DEFAULT '0',
  `EnvURL` varchar(400) NOT NULL,
  PRIMARY KEY (`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
