import { Body, Controller, Get, ParseIntPipe, Post, Query, Render, Res } from '@nestjs/common';
import { Response } from 'express';
import { CreateSymbolDto } from './symbols/dto/create-symbol.dto';
import { SymbolsService } from './symbols/symbols.service';

@Controller()
export class AppController {
  constructor(private readonly symbolsService: SymbolsService) {}

  @Get()
  @Render('index')
  async getHome(
    @Query('error') error: string
  ) {
    const listedSymbols = await this.symbolsService.findSymbols({ isListed: true });
    const notSoldSymbols = await this.symbolsService.findNotSoldSymbols();

    return { listedSymbols, notSoldSymbols, error }
  }

  @Post('submit')
  async handleHomeForm(@Body() body: CreateSymbolDto, @Res() res: Response) {
    try{
      await this.symbolsService.createSymbol(body);
  
      res.redirect('/');
    }catch(err){
      let msg;
      
      switch(err.code){
        case '23505': msg = "Symbol already exists"; break;
        default: msg = "Something went wrong"; break;
      }
  
      res.redirect('/?error=' + msg);
    }
  }

  @Post('restart-timeouts')
  async restartTimeouts(@Res() res: Response) {
    await this.symbolsService.restartTimeouts();

    res.redirect('/');
  }

  @Post('buy-symbol')
  async buySymbol(
    @Body('symbolId', ParseIntPipe) symbolId: number,
    @Body('quantity', ParseIntPipe) quantity: number,
    @Res() res: Response
  ) {
    this.symbolsService.buySymbol(symbolId, quantity);

    res.redirect('/');
  }

  @Post('sell-symbol')
  async sellSymbol(
    @Body('orderId', ParseIntPipe) orderId: number,
    @Res() res: Response
  ) {
    this.symbolsService.sellSymbol(orderId);

    res.redirect('/');
  }

  @Get('statistics')
  getStatistics() {
    return this.symbolsService.getStatistics();
  }
}
