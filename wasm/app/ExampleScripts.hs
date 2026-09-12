{-# LANGUAGE OverloadedStrings #-}
module ExampleScripts (exampleScripts) where

import Cardano.Api qualified as C
import Control.Monad (unless)
import Data.Aeson
import Data.Aeson.Types (Parser)
import Data.ByteString.Base16 qualified as Hex
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import MatchingNumber (matchingNumber, matchingRedeemer, source)

-- Example scripts, addresses and policy hashes are produced by the same
-- Cardano API inside WASM that builds and evaluates the transaction.
exampleScripts :: Value -> Parser Value
exampleScripts = withObject "example scripts" $ \o -> do
  network <- o .: "network" :: Parser Text
  unless (network `elem` ["preprod", "preview"]) (fail "Examples use Preprod or Preview test ADA.")
  let networkId = C.Testnet (C.NetworkMagic (if network == "preprod" then 1 else 2))
      script = C.PlutusScript C.PlutusScriptV2 matchingNumber
      policy = C.PlutusScript C.PlutusScriptV2 matchingRedeemer
      scriptAddress = C.makeShelleyAddress networkId (C.PaymentCredentialByScript (C.hashScript script)) C.NoStakeAddress
      plutusBytes = decodeUtf8 . Hex.encode . C.serialiseToCBOR
  key <- o .:? "paymentKeyHash" :: Parser (Maybe Text)
  native <- case key of
    Nothing -> pure Null
    Just hash -> do
      let scriptJSON = object ["type" .= ("sig" :: Text), "keyHash" .= hash]
      s <- parseJSON scriptJSON :: Parser C.SimpleScript
      pure $ object
        [ "language" .= ("Native" :: Text), "nativeScript" .= scriptJSON
        , "policyId" .= C.serialiseToRawBytesHexText (C.hashScript (C.SimpleScript s)) ]
  pure $ object
    [ "ok" .= True
    , "matchingNumber" .= object
      [ "language" .= ("PlutusV2" :: Text), "scriptCbor" .= plutusBytes matchingNumber
      , "address" .= C.serialiseAddress scriptAddress
      , "scriptHash" .= C.serialiseToRawBytesHexText (C.hashScript script)
      , "source" .= source ]
    , "redeemer42" .= object
      [ "language" .= ("PlutusV2" :: Text), "scriptCbor" .= plutusBytes matchingRedeemer
      , "policyId" .= C.serialiseToRawBytesHexText (C.hashScript policy)
      , "source" .= ("\\redeemer context -> if unIData redeemer == 42 then () else error ()" :: Text) ]
    , "nativeSignature" .= native
    ]
