using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Amazon;
using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;

using Amazon.S3;
using Amazon.S3.Util;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;


// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace RFIDInventoryStockAdjustment
{
    public class connObj
    {
        public string rfiddbuser { get; set; }
        public string rfiddbpwd { get; set; }

    }
    public class Function
    {
        IAmazonS3 S3Client { get; set; }

        /// <summary>
        /// Default constructor. This constructor is used by Lambda to construct the instance. When invoked in a Lambda environment
        /// the AWS credentials will come from the IAM role associated with the function and the AWS region will be set to the
        /// region the Lambda function is executed in.
        /// </summary>
        public Function()
        {
            S3Client = new AmazonS3Client();
        }

        /// <summary>
        /// Constructs an instance with a preconfigured S3 client. This can be used for testing the outside of the Lambda environment.
        /// </summary>
        /// <param name="s3Client"></param>
        public Function(IAmazonS3 s3Client)
        {
            this.S3Client = s3Client;
        }
        private static string getConnectionString()
        {
            string connectionString = "";

            string sqlServer = System.Environment.GetEnvironmentVariable("rfidServer");
            string sqlDatabase = System.Environment.GetEnvironmentVariable("rfidDatabase");
            string sqlUser = ""; //System.Environment.GetEnvironmentVariable("rfidUser");
            string sqlPass = ""; //System.Environment.GetEnvironmentVariable("rfidPass");
            try
            {
                string secret = GetSecret();

                connObj dbobject = JsonSerializer.Deserialize<connObj>(secret);

                sqlUser = dbobject.rfiddbuser;
                sqlPass = dbobject.rfiddbpwd;
            }
            catch (Exception e)
            {
                Console.WriteLine(e.Message);
                Console.WriteLine(e.StackTrace);
            }
            connectionString = "Data Source=" + sqlServer + "; Initial Catalog=" + sqlDatabase + ";User Id=" + sqlUser + ";Password=" + sqlPass + ";Trusted_Connection=False;";

            return connectionString;
        }

        /// <summary>
        /// This method is called for every Lambda invocation. This method takes in an S3 event object and can be used
        /// to respond to S3 notifications.
        /// </summary>
        /// <param name="evnt"></param>
        /// <param name="context"></param>
        /// <returns></returns>
        public async Task<string> FunctionHandler(S3Event evnt, ILambdaContext context)
        {
            var s3Event = evnt.Records?[0].S3;
            if(s3Event == null)
            {
                Console.WriteLine("S3 Event was null.");
                Console.WriteLine(evnt);
                return "Error parsing S3 Event";
            }
            bool pastdate = false;

            try
            {
                using (SqlConnection con = new SqlConnection(getConnectionString()))
                {
                    using (SqlCommand cmd = new SqlCommand())
                    {
                        cmd.Connection = con;

                        foreach (var record in evnt.Records)
                        {
                            using (var objectResponse = await this.S3Client.GetObjectAsync(record.S3.Bucket.Name, System.Net.WebUtility.UrlDecode(record.S3.Object.Key)))
                            {
                                context.Logger.LogLine("S3 file " + System.Net.WebUtility.UrlDecode(record.S3.Object.Key));
                                var responseStream = objectResponse.ResponseStream;
                                var reader = new StreamReader(responseStream);
                                string[] read;
                                char[] seperators = { ',' };
                                string data = reader.ReadLine();
                                DataTable rfiddata = MakeTable();

                                var ausTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Australia/Melbourne");
                                while ((data = reader.ReadLine()) != null && !pastdate )
                                {
                                    //strip quotes from data string
                                    var line = Regex.Replace(data, "\"", string.Empty);

                                    //split out csv string
                                    read = line.Split(seperators, StringSplitOptions.RemoveEmptyEntries);
                                    DateTime today = TimeZoneInfo.ConvertTime(DateTime.Now, ausTimeZone); //instead of now, use Melbournes timezone as servers are in melbourne
                                    if (!(read[0] == "Str_ID"))
                                    {
                                        int storeid = Int32.Parse(read[0]);
                                        long apn = Int64.Parse(read[1]);
                                        int kd = Int32.Parse(read[2]);
                                        int qty_salesfloor = Int32.Parse(read[3]);
                                        int qty_stockroom = Int32.Parse(read[4]);
                                        int qty_total = Int32.Parse(read[5]);
                                        DateTime snapshot_datetime = DateTime.Parse(read[6]);
                                        if (today.Date != snapshot_datetime.Date)
                                        {
                                            pastdate = true;
                                            context.Logger.LogLine("date mismatch " + snapshot_datetime);
                                            context.Logger.LogLine("Current date " + today);
                                        }
                                        int qty_ips = Int32.Parse(read[7]);

                                        //Form the data table
                                        var row = rfiddata.NewRow();
                                        row["Str_ID"] = storeid;
                                        row["APN"] = apn;
                                        row["KD"] = kd;
                                        row["Qty_SalesFloor"] = qty_salesfloor;
                                        row["Qty_Stockroom"] = qty_stockroom;
                                        row["Qty_Total"] = qty_total;
                                        row["SnapShot_DateTime"] = snapshot_datetime;
                                        //Consider moving this to null (use this field as identifier for second run) Plan change added Commit date to table instead
                                        row["Modify_DateTime"] = TimeZoneInfo.ConvertTime(DateTime.Now, ausTimeZone);
                                        //row["Modify_DateTime"] = DBNull.Value;
                                        row["Qty_IPS"] = qty_ips;
                                        rfiddata.Rows.Add(row);
                                    }
                                }
                                Console.WriteLine("rfid SV records " + rfiddata.Rows.Count);

                                // dump to DB
                                //Change this to conditional if there is no past date in the file
                                if( !pastdate ){
                                    using (SqlBulkCopy bulkCopy = new SqlBulkCopy(con))
                                    {
                                        bulkCopy.DestinationTableName = "RFID_SOH";
                                        // Set the timeou

                                        try
                                        {
                                            // Write from the source to the destination.
                                            con.Open();
                                            bulkCopy.WriteToServer(rfiddata);
                                        }
                                        catch (Exception ex)
                                        {
                                            Console.WriteLine(ex.Message);
                                        }
                                    }
                                }
                            }
                        }
                    }//end sqlcommand
                    con.Close();
                } //endsql con
            }
            catch (Exception e)
            {
                context.Logger.LogLine(e.Message);
                context.Logger.LogLine(e.StackTrace);
                throw;
            }
            finally{
                //everything is out of scope,automatically closed before it reaches here so nothing really to do..just logging hence
                //context.Logger.LogLine("Reaching finally block");
            }

            return "success";
        }


        private static DataTable MakeTable()
        // Create a new DataTable named rfidsoh.
        {
            DataTable rfidsoh = new DataTable("rfid_soh");

            // Add three column objects to the table.
            DataColumn strID = new DataColumn();
            strID.DataType = System.Type.GetType("System.Int32");
            strID.ColumnName = "Str_ID";
            rfidsoh.Columns.Add(strID);

            DataColumn APN = new DataColumn();
            APN.DataType = System.Type.GetType("System.Int64");
            APN.ColumnName = "APN";
            rfidsoh.Columns.Add(APN);

            DataColumn KD = new DataColumn();
            KD.DataType = System.Type.GetType("System.Int32");
            KD.ColumnName = "KD";
            rfidsoh.Columns.Add(KD);

            DataColumn Qty_SalesFloor = new DataColumn();
            Qty_SalesFloor.DataType = System.Type.GetType("System.Int32");
            Qty_SalesFloor.ColumnName = "Qty_SalesFloor";
            rfidsoh.Columns.Add(Qty_SalesFloor);

            DataColumn Qty_Stockroom = new DataColumn();
            Qty_Stockroom.DataType = System.Type.GetType("System.Int32");
            Qty_Stockroom.ColumnName = "Qty_Stockroom";
            rfidsoh.Columns.Add(Qty_Stockroom);

            DataColumn Qty_Total = new DataColumn();
            Qty_Total.DataType = System.Type.GetType("System.Int32");
            Qty_Total.ColumnName = "Qty_Total";
            rfidsoh.Columns.Add(Qty_Total);

            //add last 2 date columns

            DataColumn SnapShot_DateTime = new DataColumn();
            SnapShot_DateTime.DataType = System.Type.GetType("System.DateTime");
            SnapShot_DateTime.ColumnName = "SnapShot_DateTime";
            rfidsoh.Columns.Add(SnapShot_DateTime);

            DataColumn Modify_DateTime = new DataColumn();
            Modify_DateTime.DataType = System.Type.GetType("System.DateTime");
            Modify_DateTime.ColumnName = "Modify_DateTime";
            rfidsoh.Columns.Add(Modify_DateTime);

            DataColumn Qty_IPS = new DataColumn();
            Qty_IPS.DataType = System.Type.GetType("System.Int32");
            Qty_IPS.ColumnName = "Qty_IPS";
            rfidsoh.Columns.Add(Qty_IPS);

            return rfidsoh;
        }

        //Added for secrets Manager 11.06.2021
        public static string GetSecret()
        {
            // string secretName = "rfiddbuser";
            string secretName = System.Environment.GetEnvironmentVariable("rfidSecretName");
            string region = "ap-southeast-2";
            string secret = "";

            MemoryStream memoryStream = new MemoryStream();

            IAmazonSecretsManager client = new AmazonSecretsManagerClient(RegionEndpoint.GetBySystemName(region));

            GetSecretValueRequest request = new GetSecretValueRequest();
            request.SecretId = secretName;
            request.VersionStage = "AWSCURRENT"; // VersionStage defaults to AWSCURRENT if unspecified.

            GetSecretValueResponse response = null;

            try
            {
                //Console.WriteLine("getting secrets");
                response = client.GetSecretValueAsync(request).Result;
            }
            catch (DecryptionFailureException e)
            {
                // Secrets Manager can't decrypt the protected secret text using the provided KMS key.
                // Deal with the exception here, and/or rethrow at your discretion.
                Console.WriteLine(e.Message);
                throw;
            }
            catch (InternalServiceErrorException e)
            {
                // An error occurred on the server side.
                // Deal with the exception here, and/or rethrow at your discretion.
                Console.WriteLine(e.Message);
                throw;
            }
            catch (InvalidParameterException e)
            {
                // You provided an invalid value for a parameter.
                // Deal with the exception here, and/or rethrow at your discretion
                Console.WriteLine(e.Message);
                throw;
            }
            catch (InvalidRequestException e)
            {
                // You provided a parameter value that is not valid for the current state of the resource.
                // Deal with the exception here, and/or rethrow at your discretion.
                Console.WriteLine(e.Message);
                throw;
            }
            catch (ResourceNotFoundException e)
            {
                // We can't find the resource that you asked for.
                // Deal with the exception here, and/or rethrow at your discretion.
                Console.WriteLine(e.Message);
                throw;
            }
            catch (System.AggregateException ae)
            {
                // More than one of the above exceptions were triggered.
                // Deal with the exception here, and/or rethrow at your discretion.
                Console.WriteLine(ae.Message);
                throw;
            }

            // Decrypts secret using the associated KMS CMK.
            // Depending on whether the secret is a string or binary, one of these fields will be populated.
            if (response.SecretString != null)
            {
                secret = response.SecretString;
            }
            else
            {
                memoryStream = response.SecretBinary;
                StreamReader reader = new StreamReader(memoryStream);
                string decodedBinarySecret = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(reader.ReadToEnd()));
            }

            return secret;

        }


    }
}
