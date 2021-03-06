var express = require("express");
var bodyParser = require("body-parser");
var router = express.Router();
var twitter = require('../public/javascripts/twitter');

let Twit = require('twit');
let Sentiment = require('sentiment');
const CONFIG = require("../config.json");
const chart = require('chart.js')
const redis = require('redis');

const AWS = require("aws-sdk");
const bucketName = "cab432-tweetz-bucket";



// This section will change for Cloud Services or will it not?
const redisClient = redis.createClient();
redisClient.on('error', (err) => {
  console.log("Error " + err);
});


/* POST results - listening. */
router.get("/", function (req, res, next) {
  var hashtags = req.query["hashtags"];
  hashtagsforKey = hashtags;
  hashtags = hashtags.split(",");

  //Send error page if array is empty
  if (hashtags == "") {
    res
      .status(400)
      .render("error", {
        error: "Nothing to search!",
        details: "It looks like you didn't give us any terms to search for."
      });
  };

  //this is where a lot of the processing will be done

  //TODO: Check cache - if cache has data, send data

  //TODO: Check S3 - if S3 has data, send data

  //TODO: Request tweets for each hastag from Twitter - twit library

  let T = new Twit({
    consumer_key: CONFIG.twitter_api_key,
    consumer_secret: CONFIG.twitter_api_secret,
    access_token: CONFIG.twitter_access_token,
    access_token_secret: CONFIG.twiiter_access_secret
  });

  let sentiment = new Sentiment();
  var today = new Date();
  var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate() + '|' + today.getHours() + ":" + today.getMinutes();
  console.log(date);
  var rediskey = `Twitter:${hashtagsforKey}${date}`;
  console.log(rediskey);
  const s3Key = `s3Twitter-${hashtagsforKey}-${date}`;
  const params = { Bucket: bucketName, Key: s3Key };

  redisClient.get(rediskey, (err, result) => {
    if (result) {
      console.log("Data is in the redis cache")
      const resultJSON = JSON.parse(result);
      responses = doTweetStuff(resultJSON);
      [scores, scoreFrequency] = scoreSorter(responses);
      console.log("Data is now served from the cache")
      res.status(200).render("results", { hashtags: hashtags, tweetData: responses, scoreData: JSON.stringify(scores), scoreF: JSON.stringify(scoreFrequency) });

    } else {
      console.log("Not in the cache")
      T.get('search/tweets', { q: hashtags, count: 100, language: 'en' }, function (err, data, response) {
        let tweets = data.statuses;
        responses = doTweetStuff(tweets);
        [scores, scoreFrequency] = scoreSorter(responses);

        res.status(200).render("results", { hashtags: hashtags, tweetData: responses, scoreData: JSON.stringify(scores), scoreF: JSON.stringify(scoreFrequency) });
        redisClient.setex(rediskey, 3600, JSON.stringify(data.statuses));
        console.log("Data has now been stored in the cache");

        //Begin S3 Storage operations
        new AWS.S3({ apiVersion: "2006-03-01" }).getObject(
          params,
          (err, result) => {
            // Storing relevant data in S3
            const body = JSON.stringify(data.statuses);
            const objectParams = { Bucket: bucketName, Key: s3Key, Body: body };
            console.log("Made it here 1");
            const uploadPromise = new AWS.S3({ apiVersion: "2006-03-01" })
              .putObject(objectParams)
              .promise();
            console.log("Made it here 2");
            uploadPromise.then(function (data) {
              console.log(
                "Successfully uploaded data to " + bucketName + "/" + s3Key
              );
            });
          }
        );

      });


    }
  });

  //This function does tweet response analysis
  function doTweetStuff(tweets) {
    let responses = [];
    for (let i = 0; i < tweets.length; i++) {
      tweet = tweets[i].text;
      let result = JSON.stringify(sentiment.analyze(tweet).score);
      responses.push([tweet, result]);
    }
    return responses;
  }

  //This function calculates the count of tweets for each score and returns two arrays
  //a-Scores 
  //b-Scorefrequency
  function scoreSorter(responses) {
    var counts = {};
    for (let i = 0; i < responses.length; i++) {
      //Accessing the score of each tweet in responses array
      const element = responses[i][1];
      counts[element] = counts[element] ? counts[element] + 1 : 1;
    }
    a = Object.keys(counts);
    b = Object.values(counts)
    console.log(a);
    console.log(b);
    return [a, b];
  }
  //TODO: Get sentiment analysis for each set of tweets

  //TODO: Convert analysis to charts

  //TODO: Send off to storage - send both the tweets and the analysis with the hashtag as the key to cache and S3 (as a promise)

  //TODO: Display results

  //res.status(200).render("results", { hashtags: hashtags});
});

module.exports = router;
